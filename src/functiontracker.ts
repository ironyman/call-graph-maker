import { DbgChannel, assert } from './debug';
import * as vscode from 'vscode';
import { CallGraphNode, SortContext, CallGraphNodeSerializable } from './callgraphnode';

// In order that they're added to tracking.
export let TRACKED_FUNCTIONS: Array<CallGraphNode> = [];

export async function restoreTrackedFunctions(context: vscode.ExtensionContext) {
	let serializable = JSON.parse(context.workspaceState.get("TRACKED_FUNCTIONS") || "[]");
	// Maybe use context.storageUri? or globalState

	// DbgChannel.appendLine(`Got this from workspace state ${JSON.stringify(serializable)}.`);
	serializable.map((f: CallGraphNodeSerializable) => TRACKED_FUNCTIONS.push(connectTrackedNodes(f.fn, f.content, f.identifier)));
}

function saveTrackedFunctions(context: vscode.ExtensionContext) {
	let serializable = JSON.stringify(TRACKED_FUNCTIONS.map(f => new CallGraphNodeSerializable(f)));
	context.workspaceState.update("TRACKED_FUNCTIONS", serializable);
	// DbgChannel.appendLine(`Saved state ${serializable}.`);
}

function connectTrackedNodes(fn: vscode.SymbolInformation, content: string, identifier: string): CallGraphNode {
	let newNode = new CallGraphNode(fn, { content, identifier, });

	// https://stackoverflow.com/questions/7347203/circular-references-in-javascript-garbage-collector
	// don't worry about cycles
	for (let n of TRACKED_FUNCTIONS) {
		if (n.content.includes(newNode.identifier)) {
			n.outgoingCalls.push(newNode);
			newNode.incomingCalls.push(n);
		}

		if (newNode.content.includes(n.identifier)) {
			newNode.outgoingCalls.push(n);
			n.incomingCalls.push(newNode);
		}
	}

	return newNode;
}

export async function trackCurrentFunction(context: vscode.ExtensionContext) {
	let fn = await getCurrentFunction();

	if (!fn) {
		DbgChannel.appendLine(`trackCurrentFunction could not find function.`);
		return;
	}

	if (TRACKED_FUNCTIONS.find((existing) => existing.fn.name == fn!!.name)) {
		return;
	}

	DbgChannel.appendLine(`trackCurrentFunction ${fn.containerName} ${fn.name}`);

	let editor = vscode.window.visibleTextEditors.find(x => x.document.uri.toString() == fn!!.location.uri.toString());

	if (!editor) {
		DbgChannel.appendLine(`trackCurrentFunction could not find editor.`);
		return;
	}

	const content = editor.document.getText(fn.location.range);
	const identifier = fn.name.split("(")[0];
	// BUG: identifier sometimes is not the right identifier if macros are used to define function.

	TRACKED_FUNCTIONS.push(connectTrackedNodes(fn, content, identifier));
	saveTrackedFunctions(context);
}

export async function deleteTrackedFunction(context: vscode.ExtensionContext, node?: CallGraphNode | undefined) {
	if (TRACKED_FUNCTIONS.length < 1) {
		return;
	}

	if (node == undefined) {
		node = TRACKED_FUNCTIONS[TRACKED_FUNCTIONS.length - 1];
	}

	let index = TRACKED_FUNCTIONS.indexOf(node);
	if (index == -1) {
		return;
	}

	TRACKED_FUNCTIONS.splice(index, 1);

	for (let n of TRACKED_FUNCTIONS) {
		index = n.outgoingCalls.indexOf(node);
		if (index != -1) {
			n.outgoingCalls.splice(index, 1);
		}

		index = n.incomingCalls.indexOf(node);
		if (index != -1) {
			n.incomingCalls.splice(index, 1);
		}
	}

	saveTrackedFunctions(context);
}

export async function clearTrackedFunctions(context: vscode.ExtensionContext) {
	TRACKED_FUNCTIONS.length = 0;
	try {
		context.workspaceState.update("TRACKED_FUNCTIONS", undefined);
	} catch (err) {
		DbgChannel.appendLine(`clearTrackedFunctions: workspaceState.update error ${err}.`);
	};
}

export async function getCurrentFunction(): Promise<vscode.SymbolInformation | null> {
	let activeTextEditor = vscode.window.activeTextEditor;
	if (!activeTextEditor
		|| activeTextEditor.selections.length != 1) {
		return null;
	}

	// Allow selections, just treat start of selection as current.
	// if (activeTextEditor.selection.start.isBefore(activeTextEditor.selection.end)) {
	// 	return null;
	// }

	const symbols: Array<vscode.SymbolInformation> = await vscode.commands.executeCommand(
		'vscode.executeDocumentSymbolProvider', activeTextEditor.document.uri);

	if (!(Symbol.iterator in Object(symbols))) {
		if (symbols == undefined) {
			DbgChannel.appendLine(`Symbol provider not ready yet.`);
			return null;
		}
		DbgChannel.appendLine(`getCurrentFunction vscode.executeDocumentSymbolProvider failed, ${symbols}`);
		return null;
	}


	for (let s of symbols) {
		if (s.kind != vscode.SymbolKind.Function) {
			continue;
		}

		if (s.location.range.contains(activeTextEditor.selection.start)) {
			return s;
		}
	}

	return null;
}

export async function showTrackedFunctions() {
	let sortContext = new SortContext();
	sortContext.start(TRACKED_FUNCTIONS);

	let content = "";

	let visited = sortContext.visitStack.toArray();
	let indentLevel: Array<number> = new Array(visited.length);
	indentLevel[0] = 0;

	for (let i = 0; i < visited.length; ++i) {
		// Get indent level based on how many preceding nodes in topological order are callers of this node.
		getIndent: for (let j = i - 1; j >= 0; --j) {
			for (let outgoing of visited[j]!!.outgoingCalls) {
				if (outgoing.fn.name == visited[i]!!.fn.name) {
					indentLevel[i] = indentLevel[j] + 1;
					break getIndent;
				}
			}
			if (j == 0) {
				indentLevel[i] = 0;
			}
		}

		let n = visited[i]!!;
		let indent = " ".repeat(indentLevel[i]);
		content = content + indent + n.fn.name + "\n";
	}

	vscode.workspace.openTextDocument({
		content: content,
		// language: "xml"
	}).then(newDocument => {
		vscode.window.showTextDocument(newDocument);
	});
}
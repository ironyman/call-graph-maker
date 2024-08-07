import { DbgChannel, assert } from './debug';
import * as vscode from 'vscode';
import { CallGraphNode, SortContext, CallGraphNodeSerializable } from './callgraphnode';

// In order that they're added to tracking.
export let TRACKED_FUNCTIONS: Array<CallGraphNode> = [];

export async function restoreTrackedFunctions(context: vscode.ExtensionContext) {
	let serializable = JSON.parse(context.workspaceState.get("TRACKED_FUNCTIONS") || "[]");
	// Maybe use context.storageUri? or globalState

	// DbgChannel.appendLine(`Got this from workspace state ${JSON.stringify(serializable)}.`);
	let newNode = new CallGraphNode(serializable.fnPath, { content: serializable.content, callSiteName: serializable.callSiteName, });
	serializable.map((f: CallGraphNodeSerializable) => TRACKED_FUNCTIONS.push(connectTrackedNodes(newNode)));
}

function saveTrackedFunctions(context: vscode.ExtensionContext) {
	let serializable = JSON.stringify(TRACKED_FUNCTIONS.map(f => new CallGraphNodeSerializable(f)));
	context.workspaceState.update("TRACKED_FUNCTIONS", serializable);
	// DbgChannel.appendLine(`Saved state ${serializable}.`);
}

function clearVisitIndex() {
	for (let n of TRACKED_FUNCTIONS) {
		n.visitIndex = 0;
	}
}

function reversePropagateLastUpdateTime(newNode: CallGraphNode) {
	if (newNode.visitIndex == 1) {
		// Cycle detected, bail.
		return;
	}
	newNode.visitIndex = 1;

	for (let n of newNode.incomingCalls) {
		if (n.lastUpdateTimeOfChildren < newNode.lastUpdateTimeOfChildren) {
			console.log('updating ', n.displayName, newNode.lastUpdateTimeOfChildren);
			n.lastUpdateTimeOfChildren = newNode.lastUpdateTimeOfChildren;
		}
		reversePropagateLastUpdateTime(n);
	}
}

function connectTrackedNodes(newNode: CallGraphNode): CallGraphNode {
	// https://stackoverflow.com/questions/7347203/circular-references-in-javascript-garbage-collector
	// don't worry about cycles
	for (let n of TRACKED_FUNCTIONS) {
		if (n.content.includes(newNode.callSiteName)) {
			n.outgoingCalls.push(newNode);
			newNode.incomingCalls.push(n);
		}

		if (newNode.content.includes(n.callSiteName)) {
			newNode.outgoingCalls.push(n);
			n.incomingCalls.push(newNode);
		}
	}

	clearVisitIndex();
	reversePropagateLastUpdateTime(newNode);
	return newNode;
}

function clearHighlight() {
	for (let n of TRACKED_FUNCTIONS) {
		n.highlight = false;
	}
}

export async function trackCurrentFunction(context: vscode.ExtensionContext) {
	let fnPath = await getCurrentFunctionPath();

	if (fnPath.length === 0) {
		DbgChannel.appendLine(`trackCurrentFunction could not find function.`);
		return;
	}
	let fn = fnPath[fnPath.length - 1];
	let identifier = fn.name;
	if (['c', 'cpp', 'cxx'].indexOf(vscode.window.activeTextEditor?.document.languageId || '') >= 0) {
		identifier = fn.name.split("(")[0];
	} else if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].indexOf(vscode.window.activeTextEditor?.document.languageId || '') >= 0) {
		// Ignore unnamed callbacks.
		if (fnPath.length > 1 && fn.name.endsWith(' callback')) {
			fnPath = fnPath.slice(0, -1);
			fn = fnPath[fnPath.length - 1];
			identifier = fn.name;
		}
		if (fn.name === 'constructor' && fnPath.length > 1) {
			identifier = fnPath[fnPath.length - 2].name;
		}
	}

	DbgChannel.appendLine(`trackCurrentFunction ${fn.containerName} ${fn.name}`);

	let editor = vscode.window.visibleTextEditors.find(x => x.document.uri.toString() === fn!!.location.uri.toString());

	if (!editor) {
		DbgChannel.appendLine(`trackCurrentFunction could not find editor.`);
		return;
	}

	const content = editor.document.getText(fn.location.range);
	let newNode = new CallGraphNode(fnPath, { content, callSiteName: identifier, });


	let existing = TRACKED_FUNCTIONS.find((existing) => newNode.isSameReferrent(existing));
	if (existing !== undefined) {
		deleteTrackedFunction(context, existing);
	}

	// Highlight only the most recently added node.
	clearHighlight();
	newNode.highlight = true;

	TRACKED_FUNCTIONS.push(connectTrackedNodes(newNode));

	saveTrackedFunctions(context);
}

export async function deleteTrackedFunction(context: vscode.ExtensionContext, node?: CallGraphNode | undefined) {
	if (TRACKED_FUNCTIONS.length < 1) {
		return;
	}

	if (node === undefined) {
		node = TRACKED_FUNCTIONS[TRACKED_FUNCTIONS.length - 1];
	}

	let index = TRACKED_FUNCTIONS.indexOf(node);
	if (index === -1) {
		return;
	}

	TRACKED_FUNCTIONS.splice(index, 1);

	for (let n of TRACKED_FUNCTIONS) {
		index = n.outgoingCalls.indexOf(node);
		if (index !== -1) {
			n.outgoingCalls.splice(index, 1);
		}

		index = n.incomingCalls.indexOf(node);
		if (index !== -1) {
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
		|| activeTextEditor.selections.length !== 1) {
		return null;
	}

	// Allow selections, just treat start of selection as current.
	// if (activeTextEditor.selection.start.isBefore(activeTextEditor.selection.end)) {
	// 	return null;
	// }

	const symbols: Array<vscode.SymbolInformation> = await vscode.commands.executeCommand(
		'vscode.executeDocumentSymbolProvider', activeTextEditor.document.uri);

	if (!(Symbol.iterator in Object(symbols))) {
		if (symbols === undefined) {
			DbgChannel.appendLine(`Symbol provider not ready yet.`);
		} else {
			DbgChannel.appendLine(`getCurrentFunction vscode.executeDocumentSymbolProvider failed, ${symbols}`);
		}
		return null;
	}

	let path: Array<vscode.SymbolInformation> = [];
	return getFunctionAtPosition(activeTextEditor.selection.start, symbols, path);
}

async function getFunctionAtPosition(
	pos: vscode.Position,
	symbols: Array<vscode.SymbolInformation>,
	path: Array<any>): Promise<vscode.SymbolInformation | null> {

	for (let s of symbols) {

		if (!s.location.range.contains(pos)) {
			continue;
		}

		path.push(s);

		if (s.kind === vscode.SymbolKind.Function ||
			s.kind === vscode.SymbolKind.Method ||
			s.kind === vscode.SymbolKind.Constructor) {
			return s;
		}

		let children = (s as any).children;
		if (children !== undefined && children.length > 0) {
			return getFunctionAtPosition(pos, children, path);
		}
	}
	return null;
}

export async function getCurrentFunctionPath(): Promise<Array<vscode.SymbolInformation>> {
	let activeTextEditor = vscode.window.activeTextEditor;
	if (!activeTextEditor
		|| activeTextEditor.selections.length !== 1) {
		return [];
	}

	// Allow selections, just treat start of selection as current.
	// if (activeTextEditor.selection.start.isBefore(activeTextEditor.selection.end)) {
	// 	return null;
	// }

	const symbols: Array<vscode.SymbolInformation> = await vscode.commands.executeCommand(
		'vscode.executeDocumentSymbolProvider', activeTextEditor.document.uri);

	if (!(Symbol.iterator in Object(symbols))) {
		if (symbols === undefined) {
			DbgChannel.appendLine(`Symbol provider not ready yet.`);
		} else {
			DbgChannel.appendLine(`getCurrentFunction vscode.executeDocumentSymbolProvider failed, ${symbols}`);
		}
		return [];
	}

	let path: Array<vscode.SymbolInformation> = [];
	getFunctionAtPosition(activeTextEditor.selection.start, symbols, path);

	return path;
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
				if (outgoing.fn.name === visited[i]!!.fn.name) {
					indentLevel[i] = indentLevel[j] + 1;
					break getIndent;
				}
			}
			if (j === 0) {
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

export function getRootsFromTopologicallySortedFunctions(functions: Array<CallGraphNode>): Array<CallGraphNode> {
	if (functions.length === 0) {
		return [];
	}

	let sortContext = new SortContext();
	sortContext.start(functions);

	let visited = sortContext.visitStack.toArrayNonEmpty();

	// This is the last pushed node from dfs so it's definitely a root.
	let roots = [visited[0]];

	for (let i = 0; i < visited.length; ++i) {
		jLoop:
		for (let j = i - 1; j >= 0; --j) {
			for (let outgoing of visited[j].outgoingCalls) {
				if (outgoing.fn.name === visited[i].fn.name) {
					break jLoop;
				}
			}
			// If no nodes preceding this node in topologically order has called this node, then it's a root.
			// Wait there's an easier way to do this (because we're keeping track of incoming callers).
			if (j === 0) {
				roots.push(visited[i]);
			}
		}
	}

	return roots;
}

function propagateLastUpdateTime(root: CallGraphNode): Date {
	if (root.outgoingCalls.length === 0) {
		return root.lastUpdateTime;
	}
	let childMostRecentUpdateTime = root.outgoingCalls.reduce((prev, current) => {
		propagateLastUpdateTime(current);
		return prev > current.lastUpdateTimeOfChildren ? prev : current.lastUpdateTimeOfChildren;
	}, root.outgoingCalls[0].lastUpdateTimeOfChildren);

	root.lastUpdateTimeOfChildren = childMostRecentUpdateTime;
	return root.lastUpdateTimeOfChildren;
}

export function getRoots(functions: Array<CallGraphNode>): Array<CallGraphNode> {
	if (functions.length === 0) {
		return [];
	}

	let sortContext = new SortContext();
	sortContext.start(functions);

	// TODO: account for cycles, where incomingCalls could be length != 0?
	let roots = sortContext.visitStack.toArrayNonEmpty().filter(node => node.incomingCalls.length === 0);

	// Not sure why this is not setting the correct lastUpdateTimeOfChildren but we don't need to call it here.
	// for (let r of roots) {
	// 	propagateLastUpdateTime(r);
	// }

	// Descending order of lastUpdateTimeOfChildren, so implement greater than comparator.
	roots.sort((a, b) => {
		return b.lastUpdateTimeOfChildren.getTime() - a.lastUpdateTimeOfChildren.getTime();
	});
	return roots;
}
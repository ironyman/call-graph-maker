import * as vscode from 'vscode';
import { DbgChannel, assert } from './debug';
import * as process from 'process';

import {
	TRACKED_FUNCTIONS,
	trackCurrentFunction,
	clearTrackedFunctions,
	showTrackedFunctions,
	restoreTrackedFunctions,
	deleteTrackedFunction,
	getCurrentFunction
} from './functiontracker';
import { gotoLocalDefinition } from './goto';
import { CallGraphTreeDataProvider, CallGraphTreeItem } from './treeview';
import { initializeJumpHistory, notifyNavigation, updatePosition } from './jumphistory';
import path = require('path');
import { CallGraphNode } from './callgraphnode';

async function onDidChangeTextEditorSelectionListener(e: vscode.TextEditorSelectionChangeEvent) {
	console.log("selection changed");
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}

	notifyNavigation(e);

	const autoCallGraph = vscode.workspace.getConfiguration().get<boolean>('call-graph-maker.automaticCallGraphHistory');
	if (!autoCallGraph) {
		return;
	}

	// Ignore selection changes when typing, e.g. typing a new function.
	if (e.kind == vscode.TextEditorSelectionChangeKind.Keyboard) {
		return;
	}

	if (editor.document.fileName.startsWith('extension-output') || e.textEditor.document.fileName.startsWith('extension-output')) {
		// This extension will output something which will cause editor selection change in extension output view causing infinite loop.
		return;
	}
	// console.log(editor.document.fileName);

	let symbol = await getCurrentFunction();
	if (symbol) {
		vscode.commands.executeCommand('call-graph-maker.trackCurrentFunction');
	}
}

export function activate(context: vscode.ExtensionContext) {
	if (process.env.VSCODE_DEBUG_MODE === "true") {
		DbgChannel.show();
	}

	// Restore fails to restore tracked functions sometimes, the id of callgraphitems are undefined?
	// restoreTrackedFunctions(context);

	const treeDataProvider = new CallGraphTreeDataProvider(TRACKED_FUNCTIONS);
	vscode.window.registerTreeDataProvider(
		'callGraphMakerView',
		treeDataProvider
	);

	vscode.window.registerTreeDataProvider(
		'callGraphMakerViewPanel',
		treeDataProvider
	);

	// vscode.window.createTreeView('callGraphMakerView', {
	// 	treeDataProvider: new CallGraphTreeDataProvider()
	// });

	// How to display this?
	// https://github.com/microsoft/vscode/blob/d8453c04405c449b47992d1dfa08813210597a41/extensions/npm/package.json
	// https://github.com/microsoft/vscode/blob/1f86576cb95925e79d92c8af04424680bb144945/src/vs/workbench/contrib/files/browser/views/explorerView.ts
	// This is how open editors view registers buttons, not with json.
	// https://github.com/microsoft/vscode/blob/1f86576cb95925e79d92c8af04424680bb144945/src/vs/workbench/contrib/files/browser/views/openEditorsView.ts#L825
	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.refreshCallGraphMakerView', () =>
		treeDataProvider.refresh()
	));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.gotoCallSite', (item: CallGraphTreeItem) => {
		item.gotoCallSite();
	}));

	context.subscriptions.push(vscode.commands.registerTextEditorCommand('call-graph-maker.trackCurrentFunction', async (te) => {
		await trackCurrentFunction(context);
		treeDataProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.undoTrackedFunction', async (item: CallGraphTreeItem) => {
		await deleteTrackedFunction(context);
		treeDataProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.deleteTrackedFunction', async (item: CallGraphTreeItem) => {
		await deleteTrackedFunction(context, item.node);
		treeDataProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.clearTrackedFunctions', async () => {
		await clearTrackedFunctions(context);
		treeDataProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.listTrackedFunctions', async () => {
		const functions = TRACKED_FUNCTIONS.map((f) => {
			return {
				label: f.displayName,
				description: path.basename(f.fn.location.uri.path),
				original: f,
			} as vscode.QuickPickItem;
		});
		const pick = await vscode.window.showQuickPick(functions, {
			title: 'Tracked functions',
			matchOnDescription: true,
			matchOnDetail: true
		});

		if (pick === undefined) {
			return;
		}
		const node = ((pick as any).original as CallGraphNode);
		const target = node.fn.location.range.with({ end: node.fn.location.range.start });

		vscode.commands.executeCommand(
			"vscode.open",
			node.fn.location.uri,
			<vscode.TextDocumentShowOptions>{ selection: target, preserveFocus: false },
		);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.showTrackedFunctions', () => {
		showTrackedFunctions();
	}));
	context.subscriptions.push(vscode.commands.registerTextEditorCommand('call-graph-maker.gotoLocalDefinition', (te: vscode.TextEditor) => {
		gotoLocalDefinition(te);
	}));
	// context.subscriptions.push(vscode.languages.registerDocumentHighlightProvider())

	vscode.window.onDidChangeTextEditorSelection(onDidChangeTextEditorSelectionListener);
	DbgChannel.appendLine(`Call graph maker initialized using workspace ${context.extensionUri}, ${context.extensionPath}, ${context.storageUri}`);

	initializeJumpHistory(context);
}

// this method is called when your extension is deactivated
export function deactivate() { }

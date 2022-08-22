import * as vscode from 'vscode';
import { DbgChannel, assert } from './debug';
import * as process from 'process';

import { trackCurrentFunction, clearTrackedFunctions, showTrackedFunctions } from './functiontracker';
import { gotoLocalDefinition } from './goto';
import { CallGraphTreeDataProvider } from './treeview';

export function activate(context: vscode.ExtensionContext) {
	if (process.env.VSCODE_DEBUG_MODE === "true") {
		DbgChannel.show();
	}
	const treeDataProvider = new CallGraphTreeDataProvider()
	vscode.window.registerTreeDataProvider(
		'callGraphMakerView',
		treeDataProvider
	);

	// vscode.window.createTreeView('nodeDependencies', {
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

	context.subscriptions.push(vscode.commands.registerTextEditorCommand('call-graph-maker.trackCurrentFunction', async (te) => {
		await trackCurrentFunction();
		treeDataProvider.refresh()
	}));
	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.clearTrackedFunctions', async () => {
		await clearTrackedFunctions();
		treeDataProvider.refresh()
	}));
	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.showTrackedFunctions', () => {
		showTrackedFunctions();
	}));
	context.subscriptions.push(vscode.commands.registerTextEditorCommand('call-graph-maker.gotoLocalDefinition', (te: vscode.TextEditor) => {
		gotoLocalDefinition(te);
	}));
	// context.subscriptions.push(vscode.languages.registerDocumentHighlightProvider())
}

// this method is called when your extension is deactivated
export function deactivate() { }

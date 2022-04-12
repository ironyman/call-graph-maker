import * as vscode from 'vscode';
import { DbgChannel, assert } from './debug';
import * as process from 'process';

import { trackCurrentFunction, clearTrackedFunctions, showTrackedFunctions } from './functiontracker';
import { gotoLocalDefinition } from './goto';

export function activate(context: vscode.ExtensionContext) {
	if (process.env.VSCODE_DEBUG_MODE === "true") {
		DbgChannel.show();
	}

	context.subscriptions.push(vscode.commands.registerTextEditorCommand('call-graph-maker.trackCurrentFunction', (te) => {
		trackCurrentFunction();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.clearTrackedFunctions', () => {
		clearTrackedFunctions();
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

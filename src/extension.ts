import * as vscode from 'vscode';
import { DbgChannel, assert } from './debug';
import * as process from 'process';

import {
	TRACKED_FUNCTIONS,
	trackCurrentFunction,
	clearTrackedFunctions,
	showTrackedFunctions,
	restoreTrackedFunctions,
	deleteTrackedFunction } from './functiontracker';
import { gotoLocalDefinition } from './goto';
import { CallGraphTreeDataProvider, CallGraphTreeItem } from './treeview';

let clipboardHookDisposable: vscode.Disposable;

export function activate(context: vscode.ExtensionContext) {
	if (process.env.VSCODE_DEBUG_MODE === "true") {
		DbgChannel.show();
	}

	restoreTrackedFunctions(context);

	const treeDataProvider = new CallGraphTreeDataProvider(TRACKED_FUNCTIONS);
	vscode.window.registerTreeDataProvider(
		'callGraphMakerView',
		treeDataProvider
	);

	vscode.window.registerTreeDataProvider(
		'callGraphMakerViewPanel',
		treeDataProvider
	);

	// https://vscode-api.js.org/modules/vscode.commands.html#registerCommand
	clipboardHookDisposable = vscode.commands.registerCommand('editor.action.clipboardCopyAction', async (_arg: any) => clipboardCopyHook(context));
	context.subscriptions.push(clipboardHookDisposable);

	const provider = new ColorsViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ColorsViewProvider.viewType, provider));

	context.subscriptions.push(
		vscode.commands.registerCommand('calicoColors.addColor', () => {
			provider.addColor();
		}));

	context.subscriptions.push(
		vscode.commands.registerCommand('calicoColors.clearColors', () => {
			provider.clearColors();
		}));


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
		treeDataProvider.refresh()
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.undoTrackedFunction', async (item: CallGraphTreeItem) => {
		await deleteTrackedFunction(context);
		treeDataProvider.refresh()
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.deleteTrackedFunction', async (item: CallGraphTreeItem) => {
		await deleteTrackedFunction(context, item.node);
		treeDataProvider.refresh()
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.clearTrackedFunctions', async () => {
		await clearTrackedFunctions(context);
		treeDataProvider.refresh()
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.showTrackedFunctions', () => {
		showTrackedFunctions();
	}));
	context.subscriptions.push(vscode.commands.registerTextEditorCommand('call-graph-maker.gotoLocalDefinition', (te: vscode.TextEditor) => {
		gotoLocalDefinition(te);
	}));
	// context.subscriptions.push(vscode.languages.registerDocumentHighlightProvider())

	DbgChannel.appendLine(`Call graph maker initialized using workspace ${context.extensionUri}, ${context.extensionPath}, ${context.storageUri}`);
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function clipboardCopyHook(context: vscode.ExtensionContext) {
    clipboardHookDisposable.dispose();      // must dispose to avoid endless loops

    // run the built-in copy command
    await vscode.commands.executeCommand('editor.action.clipboardCopyAction');

    // get the copied text
    const clipboardText = await vscode.env.clipboard.readText();
    // use your clipboard text here
    DbgChannel.appendLine(clipboardText);

    // re-register to continue intercepting copy commands
    clipboardHookDisposable = vscode.commands.registerCommand('editor.action.clipboardCopyAction', async (_arg: any) => clipboardCopyHook(context));
    context.subscriptions.push(clipboardHookDisposable);
}


class ColorsViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'calicoColors.colorsView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case 'colorSelected':
					{
						vscode.window.activeTextEditor?.insertSnippet(new vscode.SnippetString(`#${data.value}`));
						break;
					}
			}
		});
	}

	public addColor() {
		if (this._view) {
			this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders
			this._view.webview.postMessage({ type: 'addColor' });
		}
	}

	public clearColors() {
		if (this._view) {
			this._view.webview.postMessage({ type: 'clearColors' });
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

		// Do the same for the stylesheet.
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading styles from our extension directory,
					and only allow scripts that have a specific nonce.
					(See the 'webview-sample' extension sample for img-src content security policy examples)
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

				<title>Cat Colors</title>
			</head>
			<body>
				<ul class="color-list">
				</ul>

				<button class="add-color-button">Add Color</button>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

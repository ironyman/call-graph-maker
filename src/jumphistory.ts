import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

// must initialize with initializeJumpHistory before use.
let jumpHistory: JumpHistoryTreeDataProvider = undefined as any as JumpHistoryTreeDataProvider;

class FilePosition {
	constructor(
		public document: vscode.TextDocument,
		public file: vscode.Uri,
		public position: vscode.Position,
	) {
	}
}

export class JumpHistoryTreeDataProvider implements vscode.TreeDataProvider<JumpHistoryTreeItem> {
	public jumps: Array<JumpHistoryTreeItem> = [];
	public pinned: Array<PinnedJumpHistoryTreeItem> = [];
	public currentPosition?: FilePosition;
	private MAX_JUMP_HISTORY = 99;
	public ignoreNextAddition = false;

	constructor(private context: vscode.ExtensionContext) {
	}

	private _onDidChangeTreeData: vscode.EventEmitter<JumpHistoryTreeItem | undefined | null | void> = new vscode.EventEmitter<JumpHistoryTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<JumpHistoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	getTreeItem(element: JumpHistoryTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: JumpHistoryTreeItem): Thenable<JumpHistoryTreeItem[]> {
		return Promise.resolve((this.pinned as JumpHistoryTreeItem[]).concat(this.jumps));
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	add(item: JumpHistoryTreeItem) {
		if (this.ignoreNextAddition) {
			this.ignoreNextAddition = false;
			return;
		}

		this.jumps.unshift(item);
		if (this.jumps.length > this.MAX_JUMP_HISTORY) {
			this.jumps.pop();
		}
		this._onDidChangeTreeData.fire();
	}

	previous(): JumpHistoryTreeItem | undefined {
		return this.jumps[0];
	}

	setPosition(doc: vscode.TextDocument, file: vscode.Uri, position: vscode.Position) {
		this.currentPosition = new FilePosition(doc, file, position);
	}

	// Toggle pin.
	pin(item: JumpHistoryTreeItem | PinnedJumpHistoryTreeItem) {
		let alreadyPinnedIndex = this.pinned.findIndex((p) => p.originalUnpinnedId === item.id
			|| (item as PinnedJumpHistoryTreeItem).originalUnpinnedId === p.originalUnpinnedId);
		if (alreadyPinnedIndex === -1) {
			this.pinned.push(new PinnedJumpHistoryTreeItem(item.file, item.position, item.lineText, item.excerpt, item.id!));
		} else {
			this.pinned.splice(alreadyPinnedIndex, 1);
		}
		this._onDidChangeTreeData.fire();
	}

	unpin(item: PinnedJumpHistoryTreeItem) {
		this.pinned.splice(this.pinned.indexOf(item), 1);
		this._onDidChangeTreeData.fire();
	}

	delete(item: JumpHistoryTreeItem | number) {
		if (typeof item === 'number' && item >= 0) {
			this.jumps.splice(item, 1);
		} else {
			let index = this.jumps.findIndex((p) => p.id === (item as JumpHistoryTreeItem).id);
			if (index >= 0) {
				this.jumps.splice(index, 1);
			}
		}
		this._onDidChangeTreeData.fire();
	}

	// Toggle archive.
	async archive(item: JumpHistoryTreeItem | PinnedJumpHistoryTreeItem) {
		let archive = this.getArchivedJumps();
		let alreadyArchivedIndex = archive.findIndex((p) => p.originalUnpinnedId === item.id
			|| (item as PinnedJumpHistoryTreeItem).originalUnpinnedId === p.originalUnpinnedId);
		if (alreadyArchivedIndex === -1) {
			archive.push(new PinnedJumpHistoryTreeItem(item.file, item.position, item.lineText, item.excerpt, item.id!));
		} else {
			archive.splice(alreadyArchivedIndex, 1);
		}
		return await this.saveArchivedJumps(archive);
	}

	getArchivedJumps(): PinnedJumpHistoryTreeItem[] {
		return this.context.globalState.get('call-graph-maker.jumpHistoryView.archivedJumps', []).map((item: any) => {
			let j = new PinnedJumpHistoryTreeItem(
				vscode.Uri.parse(item?.file),
				new vscode.Position(item?.position?.line, item?.position?.character),
				item?.lineText,
				item?.excerpt,
				item?.originalUnpinnedId
			);
			j.kind = JumpHistoryTreeItemKind.archived;
			return j;
		});
	}

	async saveArchivedJumps(archive: PinnedJumpHistoryTreeItem[]) {
		let items = archive.map(jump => {
			return {
				file: jump.file.toString(),
				position: {
					line: jump.position.line,
					character: jump.position.character
				},
				lineText: jump.lineText,
				excerpt: jump.excerpt,
				originalUnpinnedId: jump.originalUnpinnedId
			};
		});
		return await this.context.globalState.update('call-graph-maker.jumpHistoryView.archivedJumps', items);
	}

	clear() {
		this.jumps = [];
		this._onDidChangeTreeData.fire();
	}
}

enum JumpHistoryTreeItemKind {
	volatile = 'Session',
	pinned = 'Pinned',
	archived = 'Archived',
}

export class JumpHistoryTreeItem extends vscode.TreeItem {
	openCommand: vscode.Command;
	public kind = JumpHistoryTreeItemKind.volatile;

	constructor(
		public file: vscode.Uri,
		public position: vscode.Position,
		public lineText: string,
		public excerpt: string
	) {
		const id = uuidv4();
		super(id);
		this.label = `${path.basename(file.path)}:${position.line + 1}:${position.character + 1}`;
		this.collapsibleState = vscode.TreeItemCollapsibleState.None;
		this.id = id;
		this.description = lineText;
		this.tooltip = excerpt;

		this.command = <vscode.Command>{
			title: "Open",
			command: "call-graph-maker.jumpHistoryView.jumpNoChange",
			arguments: [
				this
			]
		};

		this.openCommand = <vscode.Command>{
			title: "Open",
			command: "vscode.open",
			arguments: [
				file,
				<vscode.TextDocumentShowOptions>{ selection: new vscode.Range(position, position), preserveFocus: false }
			]
		};
	}

	iconPath = new vscode.ThemeIcon("file");

	contextValue = 'JumpHistoryTreeItem';
}

export class PinnedJumpHistoryTreeItem extends JumpHistoryTreeItem {
	public kind = JumpHistoryTreeItemKind.pinned;

	constructor(
		public file: vscode.Uri,
		public position: vscode.Position,
		public lineText: string,
		public excerpt: string,
		public originalUnpinnedId: string,
	) {
		super(file, position, lineText, excerpt);
	}

	iconPath = new vscode.ThemeIcon("timeline-pin");

	contextValue = 'PinnedJumpHistoryTreeItem';
}

class JumpHistoryQuickPickItem implements vscode.QuickPickItem {
	label: string;
	kind?: vscode.QuickPickItemKind | undefined;
	iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri; } | undefined;
	description?: string | undefined;
	detail?: string | undefined;
	picked?: boolean | undefined;
	alwaysShow?: boolean | undefined;
	buttons?: readonly vscode.QuickInputButton[] | undefined;
	constructor(public treeItem: JumpHistoryTreeItem) {
		this.label = treeItem.label as string,
		this.description = treeItem.kind.toString(),
		this.detail = (treeItem.description as string) + treeItem.excerpt;
		this.buttons = [
			{
				iconPath: new vscode.ThemeIcon("close")
			}
		];
	}
}

export function initializeJumpHistory(context: vscode.ExtensionContext) {
	jumpHistory = new JumpHistoryTreeDataProvider(context);
	vscode.window.registerTreeDataProvider(
		'jumpHistoryView',
		jumpHistory
	);
	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.pin', async (item: JumpHistoryTreeItem) => {
		jumpHistory.pin(item);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.unpin', async (item: PinnedJumpHistoryTreeItem) => {
		jumpHistory.unpin(item);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.delete', async (item: JumpHistoryTreeItem) => {
		jumpHistory.delete(item);
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.jumpNoChange', async (item: JumpHistoryTreeItem) => {
		jumpHistory.ignoreNextAddition = true;
		vscode.commands.executeCommand(item.openCommand!.command, ...item.openCommand!.arguments!).then(() => {
			// This races.
			// jumpHistory.delete(0);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.showAll', async () => {
		let content = '';

		for (const item of jumpHistory.jumps) {
			let itemText = `
${item.file.path}:${item.position.line}:${item.position.character}:
${item.excerpt}
`;
			content += itemText;
		}

		vscode.workspace.openTextDocument({
			content: content,
		}).then(newDocument => {
			vscode.window.showTextDocument(newDocument);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.clear', async () => {
		jumpHistory.clear();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.pick', async () => {
		const jumps = (jumpHistory.pinned as JumpHistoryTreeItem[])
			.concat(jumpHistory.jumps)
			.concat(jumpHistory.getArchivedJumps())
			.map((jump) => {
			return new JumpHistoryQuickPickItem(jump);
		});
		let qp = vscode.window.createQuickPick();
		qp.items = jumps;
		qp.matchOnDescription = true;
		qp.matchOnDetail = true;
		qp.title = 'History';
		qp.onDidAccept((e) => {
			const pick = qp.activeItems[0];
			if (pick === undefined) {
				return;
			}
			vscode.commands.executeCommand((
				(<any>pick).treeItem as JumpHistoryTreeItem).command!.command,
				...((<any>pick).treeItem as JumpHistoryTreeItem).command!.arguments!);
		});
		qp.onDidTriggerItemButton(async (e) => {
			if ((e.button.iconPath as vscode.ThemeIcon)?.id !== 'close') {
				return;
			}

			let item = e.item as JumpHistoryQuickPickItem;
			if (item.treeItem.kind === JumpHistoryTreeItemKind.archived) {
				await jumpHistory.archive(item.treeItem);
			} else if (item.treeItem.kind === JumpHistoryTreeItemKind.pinned) {
				jumpHistory.pin(item.treeItem);
			} else if (item.treeItem.kind === JumpHistoryTreeItemKind.volatile) {
				jumpHistory.delete(item.treeItem);
			}
			const jumps = (jumpHistory.pinned as JumpHistoryTreeItem[])
				.concat(jumpHistory.jumps)
				.concat(jumpHistory.getArchivedJumps())
				.map((jump) => {
				return new JumpHistoryQuickPickItem(jump);
			});

			qp.items = jumps;
		});
		qp.show();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.archive', async (item: JumpHistoryTreeItem) => {
		jumpHistory.archive(item);
	}));

}

export function updatePosition(event: vscode.TextEditorSelectionChangeEvent): void {
	jumpHistory.setPosition(event.textEditor.document, event.textEditor.document.uri, event.selections[0].anchor);
}

function clamp(num: number, min: number, max: number) {
	return Math.min(Math.max(num, min), max);
}

export function notifyNavigation(event: vscode.TextEditorSelectionChangeEvent): void {
	if (event.selections.length < 1) {
		return;
	}

	if (jumpHistory.currentPosition !== undefined) {
		const TEXT_EDITOR_SELECTION_THRESHOLD = 10
		if (event.textEditor.document.uri.path === jumpHistory.currentPosition.file.path
			&& Math.abs(event.selections[0].anchor.line - jumpHistory.currentPosition.position.line) < TEXT_EDITOR_SELECTION_THRESHOLD
		) {
			updatePosition(event);
			return;
		}
	}

	const prevPos = jumpHistory.currentPosition;
	if (prevPos) {
		const text = prevPos.document.getText();

		const lineStart = new vscode.Position(jumpHistory.currentPosition!.position.line, 0);
		const lineStartOffset = prevPos.document.offsetAt(lineStart);
		let lineEndOffset = text.indexOf('\n', lineStartOffset);
		if (lineEndOffset === -1) {
			lineEndOffset = text.length - 1;
			if (lineEndOffset < 0) {
				lineEndOffset = 0;
			}
		}
		const lineText = text.slice(lineStartOffset, lineEndOffset).trim();

		const EXCERPT_CONTEXT = 10;
		const excerptLineStart = clamp(prevPos.position.line - EXCERPT_CONTEXT, 0, prevPos.document.lineCount - 1);
		const excerptLineEnd = clamp(prevPos.position.line + EXCERPT_CONTEXT, 0, prevPos.document.lineCount - 1);
		lineEndOffset = text.indexOf('\n', prevPos.document.offsetAt(new vscode.Position(excerptLineEnd, 0)));
		if (lineEndOffset === -1) {
			lineEndOffset = clamp(text.length - 1, 0, text.length);
		}
		const excerpt = text.slice(prevPos.document.offsetAt(new vscode.Position(excerptLineStart, 0)),
			lineEndOffset);

		jumpHistory.add(new JumpHistoryTreeItem(prevPos.document.uri, prevPos.position, lineText, excerpt));
	}
	updatePosition(event);
}
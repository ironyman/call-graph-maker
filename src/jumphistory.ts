import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

// must initialize with initializeJumpHistory before use.
let jumpHistory: JumpHistoryTreeDataProvider = undefined as any;
let jumpTreeView: vscode.TreeView<JumpHistoryTreeItem> = undefined as any;

class FilePosition {
	constructor(
		public document: vscode.TextDocument,
		public file: vscode.Uri,
		public position: vscode.Position,
	) {
	}
}

function groupBy(xs: Array<any>, key: string | Function) {
	return xs.reduce(function(rv, x) {
		var v = key instanceof Function ? key(x) : x[key];
		(rv[v] = rv[v] || []).push(x);
		return rv;
	}, {});
}

function symbolPathEqual(
	array1: Array<vscode.SymbolInformation> | null | undefined,
	array2: Array<vscode.SymbolInformation> | null | undefined
): boolean {
	if (!array1 && array2 ||
		array1 && !array2
	) {
		return false;
	}

	if (!array1 && array2) {
		return true;
	}

	if (array1!.length != array2!.length) {
		return false;
	}

	for (let i = 0; i < array1!.length; ++i) {
		if (array1![i].name != array2![i].name) {
			return false;
		}

		if (array1![i].location.uri.toString() != array2![i].location.uri.toString()) {
			return false;
		}

		if (!array1![i].location.range.isEqual(array2![i].location.range)) {
			return false;
		}
	}

	return true;
}

export class JumpHistoryTreeDataProvider implements vscode.TreeDataProvider<JumpHistoryTreeItem> {
	public jumps: Array<JumpHistoryTreeItem> = [];
	public pinned: Array<PinnedJumpHistoryTreeItem> = [];
	public currentPosition?: FilePosition;
	private MAX_JUMP_HISTORY = 99;
	public ignoreNextAddition = false;
	public enableSymbolGrouping = true;
	private cachedGroupedJumps: JumpHistoryTreeItem[] = [];
	public cachedRootChildren: JumpHistoryTreeItem[] = [];

	constructor(private context: vscode.ExtensionContext) {
	}

	private _onDidChangeTreeData: vscode.EventEmitter<JumpHistoryTreeItem | undefined | null | void> = new vscode.EventEmitter<JumpHistoryTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<JumpHistoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

	getTreeItem(element: JumpHistoryTreeItem): vscode.TreeItem {
		return element;
	}

	getRootChildren(): Thenable<JumpHistoryTreeItem[]> {
		if (!this.enableSymbolGrouping || this.jumps.length <= 1) {
			this.cachedRootChildren = (this.pinned as JumpHistoryTreeItem[]).concat(this.jumps);
			return Promise.resolve(this.cachedRootChildren);
		}

		let groupedJumps: JumpHistoryTreeItem[] = [];
		let currentGroup: JumpHistoryTreeItemGroup | undefined;

		for (let i = 1; i < this.jumps.length; ++i) {
			if (this.jumps[i].label == this.jumps[i - 1].label) {
				if (currentGroup == undefined) {
					const first = this.jumps[i - 1];
					currentGroup = new JumpHistoryTreeItemGroup(
						first.file,
						first.symbolPath,
						first.position,
						first.lineText,
						first.excerpt, [first]);
					groupedJumps.push(currentGroup);
				}
				currentGroup.children.push(this.jumps[i]);
			} else if (currentGroup != undefined) {
				currentGroup = undefined;
			} else {
				groupedJumps.push(this.jumps[i - 1]);
				if (i == this.jumps.length - 1) {
					groupedJumps.push(this.jumps[i]);
				}
			}
		}

		// Copy collapse state from previous grouped jumps.
		let groupedJumpsOnly = groupedJumps.filter(x => x.kind == JumpHistoryTreeItemKind.Group);
		let cachedGroupedJumpsOnly = this.cachedGroupedJumps.filter(x => x.kind == JumpHistoryTreeItemKind.Group);
		let groupedJumpsIndex = groupedJumpsOnly.length - 1;
		let cachedGroupedJumpsIndex = cachedGroupedJumpsOnly.length - 1;

		while (cachedGroupedJumpsIndex >= 0 &&
				!symbolPathEqual(groupedJumpsOnly[groupedJumpsIndex].symbolPath,
				cachedGroupedJumpsOnly[cachedGroupedJumpsIndex].symbolPath))
		{
			--cachedGroupedJumpsIndex;
		}

		while (cachedGroupedJumpsIndex >= 0) {
			// groupedJumpsOnly[groupedJumpsIndex].collapsibleState =
			// cachedGroupedJumpsOnly[cachedGroupedJumpsIndex].collapsibleState;
			// Collapsible state is tracked internal to vscode by id
			groupedJumpsOnly[groupedJumpsIndex].id = cachedGroupedJumpsOnly[cachedGroupedJumpsIndex].id;
			--cachedGroupedJumpsIndex;
			--groupedJumpsIndex
		}

		this.cachedGroupedJumps = groupedJumps;
		this.cachedRootChildren = (this.pinned as JumpHistoryTreeItem[]).concat(groupedJumps);
		// Need to preserve id for reveal to work.
		return Promise.resolve(this.cachedRootChildren);

	}

	getChildren(element?: JumpHistoryTreeItem): Thenable<JumpHistoryTreeItem[]> {
		if (!element) {
			return this.getRootChildren();
		}
		return Promise.resolve((element as JumpHistoryTreeItemGroup).children);
	}

	getParent(element: JumpHistoryTreeItem): Thenable<JumpHistoryTreeItem> {
		if (this.cachedRootChildren.find(x => x.id == element.id)) {
			return Promise.resolve(undefined!);
		}
		let groups = this.cachedRootChildren.filter(
			x => x.kind == JumpHistoryTreeItemKind.Group) as JumpHistoryTreeItemGroup[];
		for (const g of groups) {
			if (g.children.find(x => x.id == element.id)) {
				return Promise.resolve(g);
			}
		}
		return null!;
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
			this.pinned.push(new PinnedJumpHistoryTreeItem(item.file, item.symbolPath, item.position, item.lineText, item.excerpt, item.id!));
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
			archive.push(new PinnedJumpHistoryTreeItem(item.file, item.symbolPath, item.position, item.lineText, item.excerpt, item.id!));
		} else {
			archive.splice(alreadyArchivedIndex, 1);
		}
		return await this.saveArchivedJumps(archive);
	}

	getArchivedJumps(): PinnedJumpHistoryTreeItem[] {
		return this.context.globalState.get('call-graph-maker.jumpHistoryView.archivedJumps', []).map((item: any) => {
			let j = new PinnedJumpHistoryTreeItem(
				vscode.Uri.parse(item?.file),
				item?.symbolPath,
				new vscode.Position(item?.position?.line, item?.position?.character),
				item?.lineText,
				item?.excerpt,
				item?.originalUnpinnedId
			);
			j.kind = JumpHistoryTreeItemKind.Archived;
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
	Volatile = 'Session',
	Pinned = 'Pinned',
	Archived = 'Archived',
	Group = 'Group',
}

export class JumpHistoryTreeItem extends vscode.TreeItem {
	openCommand: vscode.Command;
	public kind = JumpHistoryTreeItemKind.Volatile;

	constructor(
		public file: vscode.Uri,
		public symbolPath: Array<vscode.SymbolInformation> | undefined,
		public position: vscode.Position,
		public lineText: string,
		public excerpt: string
	) {
		const id = uuidv4();
		super(id);
		this.label = symbolPath?.map(s => s.name).join(' > ') || lineText;
		this.collapsibleState = vscode.TreeItemCollapsibleState.None;
		this.id = id;
		// this.description = lineText;
		this.description = `${path.basename(file.path)}:${position.line + 1}:${position.character + 1}`;
		this.tooltip = `${this.label}\n${this.description}\n${this.excerpt}`;

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

export class JumpHistoryTreeItemGroup extends JumpHistoryTreeItem {
	iconPath = new vscode.ThemeIcon("symbol-function");
	public kind = JumpHistoryTreeItemKind.Group;
	contextValue = 'JumpHistoryTreeItemGroup';
	collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	constructor(
		public file: vscode.Uri,
		public symbolPath: Array<vscode.SymbolInformation> | undefined,
		public position: vscode.Position,
		public lineText: string,
		public excerpt: string,
		public children: Array<JumpHistoryTreeItem> = [],
	) {
		super(file, symbolPath, position, lineText, excerpt);
	}
}

export class PinnedJumpHistoryTreeItem extends JumpHistoryTreeItem {
	public kind = JumpHistoryTreeItemKind.Pinned;

	constructor(
		public file: vscode.Uri,
		public symbolPath: Array<vscode.SymbolInformation> | undefined,
		public position: vscode.Position,
		public lineText: string,
		public excerpt: string,
		public originalUnpinnedId: string,
	) {
		super(file, symbolPath, position, lineText, excerpt);
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

async function showJumpHistoryPicker(grouped: boolean = true) {
	let jumps;

	if (grouped) {
		jumps = (jumpHistory.pinned as JumpHistoryTreeItem[])
			.concat(await jumpHistory.getRootChildren())
			.concat(jumpHistory.getArchivedJumps())
			.map((jump) => {
				return new JumpHistoryQuickPickItem(jump);
			});
	} else {
		jumps = (jumpHistory.pinned as JumpHistoryTreeItem[])
			.concat(jumpHistory.jumps)
			.concat(jumpHistory.getArchivedJumps())
			.map((jump) => {
				return new JumpHistoryQuickPickItem(jump);
			});
	}

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
		if (item.treeItem.kind === JumpHistoryTreeItemKind.Archived) {
			await jumpHistory.archive(item.treeItem);
		} else if (item.treeItem.kind === JumpHistoryTreeItemKind.Pinned) {
			jumpHistory.pin(item.treeItem);
		} else if (item.treeItem.kind === JumpHistoryTreeItemKind.Volatile) {
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
}

export function initializeJumpHistory(context: vscode.ExtensionContext) {
	jumpHistory = new JumpHistoryTreeDataProvider(context);
	// vscode.window.registerTreeDataProvider(
	// 	'jumpHistoryView',
	// 	jumpHistory
	// );

	jumpTreeView = vscode.window.createTreeView('jumpHistoryView', {
		treeDataProvider: jumpHistory,
		showCollapseAll: true,
	});

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

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.flatten', async () => {
		jumpHistory.enableSymbolGrouping = !jumpHistory.enableSymbolGrouping;
		jumpHistory.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.top', async () => {
		const nodes = jumpHistory?.cachedRootChildren;
		if (nodes && nodes.length > 0) {
			await jumpTreeView.reveal(nodes[0], {
				expand: true,
				select: true,
				focus: true,
			});
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.clear', async () => {
		jumpHistory.clear();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.pickGrouped', async () => {
		showJumpHistoryPicker();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('call-graph-maker.jumpHistoryView.pick', async () => {
		showJumpHistoryPicker(false);
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

async function getSymbolPathAtPosition(
	pos: FilePosition,
	path?: Array<any>,
	symbols?: Array<vscode.SymbolInformation>): Promise<Array<vscode.SymbolInformation> | null>
{
	if (symbols == null || symbols.length == 0) {
		symbols = await vscode.commands.executeCommand(
			'vscode.executeDocumentSymbolProvider', pos.document.uri);
	}

	if (!(Symbol.iterator in Object(symbols))) {
		// if (symbols === undefined) {
		// 	DbgChannel.appendLine(`Symbol provider not ready yet.`);
		// } else {
		// 	DbgChannel.appendLine(`getCurrentFunction vscode.executeDocumentSymbolProvider failed, ${symbols}`);
		// }
		return null;
	}

	if (!path) {
		path = new Array();
	}

	for (let s of symbols!) {
		if (!s.location.range.contains(pos.position)) {
			continue;
		}

		path.push(s);

		let children = (s as any).children;
		if (children !== undefined && children.length > 0) {
			return getSymbolPathAtPosition(pos, path, children);
		}
	}

	return path;
}

export async function notifyNavigation(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
	if (event.selections.length < 1) {
		return;
	}
	if (event.textEditor.document.uri.toString().startsWith('search-editor:') ||
		event.textEditor.document.uri.toString().startsWith('output:')) {
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

		const symbolPath = await getSymbolPathAtPosition(prevPos) || undefined;

		jumpHistory.add(new JumpHistoryTreeItem(prevPos.document.uri, symbolPath, prevPos.position, lineText, excerpt));
	}
	updatePosition(event);
}
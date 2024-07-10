import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

// must initialize with initializeJumpHistory before use.
let jumpHistory: JumpHistoryTreeDataProvider = undefined as any as JumpHistoryTreeDataProvider;

class FilePosition {
    constructor(
        public file: vscode.Uri,
        public position: vscode.Position,
    ) {
    }
}

export class JumpHistoryTreeDataProvider implements vscode.TreeDataProvider<JumpHistoryTreeItem> {
    private jumps: Array<JumpHistoryTreeItem> = [];
    public currentPosition?: FilePosition;
    private MAX_JUMP_HISTORY = 99;

    constructor() {
    }

    private _onDidChangeTreeData: vscode.EventEmitter<JumpHistoryTreeItem | undefined | null | void> = new vscode.EventEmitter<JumpHistoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<JumpHistoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: JumpHistoryTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: JumpHistoryTreeItem): Thenable<JumpHistoryTreeItem[]> {
        return Promise.resolve(this.jumps);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    add(item: JumpHistoryTreeItem) {
        this.jumps.unshift(item);
        if (this.jumps.length > this.MAX_JUMP_HISTORY) {
            this.jumps.pop();
        }
        this._onDidChangeTreeData.fire();
    }

    previous(): JumpHistoryTreeItem | undefined {
        return this.jumps[0];
    }

    setPosition(file: vscode.Uri, position: vscode.Position) {
        this.currentPosition = new FilePosition(file, position);
    }
}

export class JumpHistoryTreeItem extends vscode.TreeItem {
    constructor(
        public file: vscode.Uri,
        public position: vscode.Position,
        public excerpt: string
    ) {
        const id = uuidv4();
        super(id);
        this.label = path.basename(file.path);
        this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        this.id = id;
        this.description = `${position.line + 1}:${position.character + 1}`;
        this.tooltip = excerpt;

        this.command = <vscode.Command>{
            title: "Open",
            command: "vscode.open",
            arguments: [
                file,
                <vscode.TextDocumentShowOptions>{ selection: new vscode.Range(position, position), preserveFocus: false }
            ]
        };
    }

    iconPath = new vscode.ThemeIcon("go-to-file");

    contextValue = 'JumpHistoryTreeItem';
}

export function initializeJumpHistory(context: vscode.ExtensionContext) {
    jumpHistory = new JumpHistoryTreeDataProvider();
    vscode.window.registerTreeDataProvider(
		'jumpHistoryView',
		jumpHistory
	);
}

export function updatePosition(event: vscode.TextEditorSelectionChangeEvent): void {
    jumpHistory.setPosition(event.textEditor.document.uri, event.selections[0].anchor);
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

    updatePosition(event);

    const text = event.textEditor.document.getText();
    const lineStart = new vscode.Position(event.selections[0].anchor.line, 0);
    const lineStartOffset = event.textEditor.document.offsetAt(lineStart);
    let lineEndOffset = text.indexOf('\n', lineStartOffset);
    if (lineEndOffset === -1) {
        lineEndOffset = text.length - 1;
        if (lineEndOffset < 0) {
            lineEndOffset = 0;
        }
    }
    const excerpt = text.slice(lineStartOffset, lineEndOffset);

    jumpHistory.add(new JumpHistoryTreeItem(event.textEditor.document.uri, event.selections[0].anchor, excerpt));
}
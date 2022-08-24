import * as vscode from 'vscode';
import { TRACKED_FUNCTIONS } from './functiontracker';
import { CallGraphNode, SortContext } from './callgraphnode';
import { gotoReferenceInFunction } from './goto';

// https://github.com/microsoft/vscode-extension-samples/tree/main/tree-view-sample
export class CallGraphTreeDataProvider implements vscode.TreeDataProvider<CallGraphTreeItem> {
    constructor() {}

    private _onDidChangeTreeData: vscode.EventEmitter<CallGraphTreeItem | undefined | null | void> = new vscode.EventEmitter<CallGraphTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CallGraphTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: CallGraphTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CallGraphTreeItem): Thenable<CallGraphTreeItem[]> {
        if (element) {
            return Promise.resolve(
                element?.node.outgoingCalls.map(f => new CallGraphTreeItem(f,
                    element!,
                    f.outgoingCalls.length > 0
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None)));
        } else {
            // I don't think this works for recursive functions.
            return Promise.resolve(TRACKED_FUNCTIONS
                .filter(f => f.incomingCalls.length == 0)
                .map(f => new CallGraphTreeItem(f,
                    null,
                    f.outgoingCalls.length > 0
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.None)));
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

export class CallGraphTreeItem extends vscode.TreeItem {
    constructor(
        public readonly node: CallGraphNode,
        public readonly treeItemParent: CallGraphTreeItem | null,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        let label = node.fn.name;
        super(label, collapsibleState);
        this.tooltip = label;
        this.id = node.fn.location.uri + ":" + node.fn.location.range.start + ":" + label;

        // console.log("Created", this);

        // https://github.com/microsoft/vscode/blob/b32bd476eb541238f964343a0a71d9e73d08e5c9/extensions/references-view/src/types/model.ts
        // https://code.visualstudio.com/api/references/commands
        this.command = <vscode.Command>{
            title: "Open",
            command: "vscode.open",
            arguments: [
                node.fn.location.uri,
                <vscode.TextDocumentShowOptions>{ selection: node.fn.location.range.with({ end: node.fn.location.range.start }) }
            ]
        };

        // ${node.fn.location}
        // node.identifier, is sometimes wrong if weird macros are used may conflict if identifiers are same.
        // node.fn.containerName is susually empty
        // this.description = ``;
    }

    gotoCallSite() {
        if (this.treeItemParent) {
            gotoReferenceInFunction(this.node.identifier, this.treeItemParent.node.fn);
        }
    }

    // iconPath = {
    //     light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
    //     dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg')
    // };
    iconPath = new vscode.ThemeIcon("symbol-function");

    contextValue = 'CallGraphTreeItem';
}

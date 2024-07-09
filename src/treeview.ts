import * as vscode from 'vscode';
import { CallGraphNode, SortContext } from './callgraphnode';
import { gotoReferenceInFunction } from './goto';
import * as path from 'path';
import { getRoots } from './functiontracker';
import { v4 as uuidv4 } from 'uuid';

// https://github.com/microsoft/vscode-extension-samples/tree/main/tree-view-sample
export class CallGraphTreeDataProvider implements vscode.TreeDataProvider<CallGraphTreeItem> {
    constructor(private trackedFunctions: Array<CallGraphNode>) {
    }

    private _onDidChangeTreeData: vscode.EventEmitter<CallGraphTreeItem | undefined | null | void> = new vscode.EventEmitter<CallGraphTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CallGraphTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: CallGraphTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CallGraphTreeItem): Thenable<CallGraphTreeItem[]> {
        if (element) {
            let outgoingCalls = Array.from(element?.node.outgoingCalls);
            // lastUpdateTimeOfChildren should have calculated in getRoots and connectTrackedNodes already.
            outgoingCalls.sort((a, b) => {
                return b.lastUpdateTimeOfChildren.getTime() - a.lastUpdateTimeOfChildren.getTime();
            });
            return Promise.resolve(
                outgoingCalls.map(f => new CallGraphTreeItem(f,
                    element!,
                    f.outgoingCalls.length > 0
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.None)));
        } else {
            let roots = getRoots(this.trackedFunctions).map(f => new CallGraphTreeItem(f,
                null, vscode.TreeItemCollapsibleState.Expanded));
            return Promise.resolve(roots);
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

        super(node.displayName, collapsibleState);
        this.label = {
            label: node.displayName,
            highlights: node.highlight ? [
                [0, node.displayName.length]
            ] : []
        };
        // Expanded by default
        this.collapsibleState = collapsibleState;
        this.tooltip = node.displayName;
        // this.id = node.fn.location.uri + ":" + node.fn.location.range.start.line + ":" + label + treeItemParent?.node.callSiteName;
        // this.id = node.displayName;
        // Because multiple nodes could have the same children, the same child node could be displayed multiple times in tree view
        // which would all require different id to be rendered.
        this.id = uuidv4();
        this.description = path.basename(node.fn.location.uri.path);
        // console.log("Created", this);

        // https://github.com/microsoft/vscode/blob/b32bd476eb541238f964343a0a71d9e73d08e5c9/extensions/references-view/src/types/model.ts
        // https://code.visualstudio.com/api/references/commands

        // node.fn.location.range and node.fn is just a dictionary when we deserialize so we can't use .with method.
        // You can see it crash when you bp and enable bp on caught exceptions.
        let target;
        try {
            target = node.fn.location.range.with({ end: node.fn.location.range.start });
        } catch {
            // It looks like this when you deserialize it lol.
            let temp = node.fn.location.range as any;
            target = new vscode.Range(new vscode.Position(temp[0].line, temp[0].character), new vscode.Position(temp[0].line, temp[0].character));
        }

        this.command = <vscode.Command>{
            title: "Open",
            command: "vscode.open",
            arguments: [
                node.fn.location.uri,
                <vscode.TextDocumentShowOptions>{ selection: target }
            ]
        };

        // ${node.fn.location}
        // node.callSiteName, is sometimes wrong if weird macros are used may conflict if identifiers (callSiteName) are same.
        // node.fn.containerName is susually empty
        // this.description = ``;
    }

    gotoCallSite() {
        if (this.treeItemParent) {
            gotoReferenceInFunction(this.node.callSiteName, this.treeItemParent.node.fn);
        }
    }

    // iconPath = {
    //     light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
    //     dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg')
    // };
    iconPath = new vscode.ThemeIcon("symbol-function");

    contextValue = 'CallGraphTreeItem';
}

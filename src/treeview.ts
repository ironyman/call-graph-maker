import * as vscode from 'vscode';
import { CallGraphNode, SortContext } from './callgraphnode';
import { gotoReferenceInFunction } from './goto';


function getRootsFromSort(functions: Array<CallGraphNode>): Array<CallGraphNode> {
    if (functions.length == 0) {
        return [];
    }

	let sortContext = new SortContext();
	sortContext.start(functions);

	let visited = sortContext.visitStack.toArray();
	let indentLevel: Array<number> = new Array(visited.length);
	indentLevel[0] = 0;

    let roots = [visited[0]!];

	for (let i = 0; i < visited.length; ++i) {
		getIndent: for (let j = i - 1; j >= 0; --j) {
			for (let outgoing of visited[j]!!.outgoingCalls) {
				if (outgoing.fn.name == visited[i]!!.fn.name) {
					indentLevel[i] = indentLevel[j] + 1;
					break getIndent;
				}
			}
			if (j == 0) {
				roots.push(visited[i]!);
			}
		}
	}

    return roots;
}

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
            return Promise.resolve(
                element?.node.outgoingCalls.map(f => new CallGraphTreeItem(f,
                    element!,
                    f.outgoingCalls.length > 0
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None)));
        } else {
            // I don't think this works for recursive functions.
            // console.log(trackedFunctions);
            let roots = this.trackedFunctions
                .filter(f => {
                    return f.incomingCalls.length == 0;
                })
                .map(f => new CallGraphTreeItem(f,
                    null,
                    f.outgoingCalls.length > 0
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.None));
            // console.log(roots);

            if (roots.length == 0 && this.trackedFunctions.length > 0) {
                // There are cycles in call graph, we'll show the topological sort instead.
                roots = getRootsFromSort(this.trackedFunctions).map(f => new CallGraphTreeItem(f,
                    null,
                    f.outgoingCalls.length > 0
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.None));
            }
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
        let label = node.fn.name;
        super(label, collapsibleState);
        this.tooltip = label;
        this.id = node.fn.location.uri + ":" + node.fn.location.range.start + ":" + label + treeItemParent?.node.identifier;

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

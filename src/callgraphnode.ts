import { DbgChannel, assert } from './debug';
import * as vscode from 'vscode';

class SingleListEntry<T> {
	next: SingleListEntry<T> | undefined;

	// The head may have undefined container. 
	container: T | undefined;

	constructor(container?: T, next?: SingleListEntry<T>) {
		this.container = container;
		this.next = next;
	}

	pushListEntry(next: SingleListEntry<T>) {
		next.next = this.next;
		this.next = next;
	}

	popListEntry() {
		let first = this.next;
		if (first != undefined) {
			this.next = first.next;
		}
		return first;
	}

	toArray(): Array<T | undefined> {
		let node = this.next;
		let result = [];
		while (node != undefined) {
			result.push(node.container);
			node = node.next;
		}
		return result;
	}
}

export class CallGraphNode {
	fn: vscode.SymbolInformation;
	incomingCalls: Array<CallGraphNode>;
	outgoingCalls: Array<CallGraphNode>;
    content: string;
    identifier: string;

	// Variables for Tarjan's SCC and topolgical sort finding algorithm
	// Tarjan calls this NUMBER. It's the iteration number of depth first search when 
	// this node is visited. 0 means unvisited.
	visitIndex: number;

	// A little context, performing DFS on a directed graph and recording the nodes visited
	// forms a palm forest. 
	// LOWLINK is the lowest visitIndex of a node reachable from this node (including this node)
	// via any number of forward edges followed by a back edge or a cross link edge and that node is 
	// not part of a previously found SCC.
	// The nodes with the same LOWLINK are in the same SCC. 
	lowlink: number;

	// If this node is in an SCC, this list connects to other nodes of the same SCC.
	componentList: SingleListEntry<CallGraphNode>;

	resetSortState() {
		this.visitIndex = 0;
		this.lowlink = 0;
		this.componentList = new SingleListEntry(this);
	}

	constructor(fn: vscode.SymbolInformation, opts?: {
		incomingCalls?: Array<CallGraphNode>,
		outgoingCalls?: Array<CallGraphNode>,
        content?: string,
        identifier?: string,
	}) {
		this.fn = fn;
		this.incomingCalls = new Array;
		this.outgoingCalls = new Array;
        this.content = "";
        this.identifier = "";

		this.visitIndex = 0;
		this.lowlink = 0;
		this.componentList = new SingleListEntry(this);

		if (typeof opts != 'undefined') {
			if (typeof opts.incomingCalls !== 'undefined') {
				this.incomingCalls = [...opts.incomingCalls];
			}

			if (typeof opts.outgoingCalls !== 'undefined') {
				this.outgoingCalls = [...opts.outgoingCalls];
			}

            if (typeof opts.content !== 'undefined') {
				this.content = opts.content;
			}
            
            if (typeof opts.identifier !== 'undefined') {
				this.identifier = opts.identifier;
			}
		}
	}
}

export class TarjanContext {
	// As we visit the nodes, we push them on the visit stack
	// and assign the node an index, in order that they're visited.
	// visitIndex == 0 means unvisited, we increment visitIndex
	// as we visit unvisited nodes.
	visitStack = new SingleListEntry<CallGraphNode>();
	visitIndex: number = 0;

	// Start Tarjan's algorithm at all nodes.
	start(nodes: Array<CallGraphNode>) {
		for (let n of nodes) {
			n.resetSortState();
		}

		// let visitStackBottom = new CallGraphNode(
		// 	new vscode.SymbolInformation(
		// 		"", vscode.SymbolKind.Boolean, "", new vscode.Location(vscode.Uri.parse("https://"), new vscode.Position(0, 0))
		// 	)
		// );
		// Create a bottom so that when a visited node is pushed to visitStack, the node's componentList will 
		// point to something (either visitStackBottom or another real node) so we know it's on the stack.

		let visitStackBottom = new SingleListEntry<CallGraphNode>();
		this.visitStack.pushListEntry(visitStackBottom);

		for (let n of nodes) {
			if (n.visitIndex == 0) {
				this.dfs(n);
			}
		}

		assert(this.visitStack.next == visitStackBottom);
	}

	dfs(node: CallGraphNode) {
		++this.visitIndex;

		// Note that nodes with the same lowlink are in the same SCC.
		node.lowlink = node.visitIndex = this.visitIndex;

		this.visitStack.pushListEntry(node.componentList);
		for (let neighbor of node.outgoingCalls) {
			if (neighbor.visitIndex == 0) {
				// Neighbor is unvisited, continue search.
				this.dfs(neighbor);
				if (node.lowlink > neighbor.lowlink) {
					node.lowlink = neighbor.lowlink;
				}
			} else if (neighbor.componentList.next != undefined) {
				// Not only is neighbor visited, but it's also not in a previously
				// found SCC.
				if (node.lowlink > neighbor.visitIndex) {
					node.lowlink = neighbor.visitIndex
				}
			}
		}

		if (node.lowlink == node.visitIndex) {
			let connectedHead = new SingleListEntry();
			let connected = this.visitStack.popListEntry();

			// If this node is not in a cycle, then connected == node.componentList what we pushed earlier.

			while (node.componentList != connected) {
				connectedHead.pushListEntry(connected!!);
				connected = this.visitStack.popListEntry();
			}

			// Thus connected and connectedHead forms a SCC.
		}
	}
}

export class SortContext {
	visitStack = new SingleListEntry<CallGraphNode>();

	// Post order DFS traversal on all nodes and push them on to visitStack for post order operation.
	// https://en.wikipedia.org/wiki/Tree_traversal#Post-order,_LRN
	// https://cs.stackexchange.com/questions/44820/what-does-pre-post-and-in-order-walk-mean-for-a-n-ary-tree#:~:text=Post-order%20traversal%20is%20one%20where%20the%20pre-order%20operation,It%20probably%20only%20makes%20sense%20for%20binary%20trees.
	start(nodes: Array<CallGraphNode>) {
		for (let n of nodes) {
			n.resetSortState();
		}

		for (let n of nodes) {
			if (n.visitIndex == 0) {
				this.dfs(n);
			}
		}

		// this.visitStack.next = this.reverse(this.visitStack.next);
	}

	// a ->  b  -> c 
	// enter a
	//   enter b
	//     enter c 
	//       return c
	//     rest = c
	//     head = b
	//     head.next.next = c.next = b
	//     b.next = undefined
	//     return c
	//   rest = c
	//   head = a
	//   head.next.next = a.next.next = b.next = a
	//   a.next = undefined
	//   return c

	reverse(head?: SingleListEntry<CallGraphNode>): SingleListEntry<CallGraphNode> | undefined {
		if (head == undefined || head.next == undefined)
			return head;
		let tail = this.reverse(head.next); // Return tail so it becomes the new head.

		head.next.next = head;

		// This will be set in the parent call, when this call returns, unless if head is 
		// actual head of the list, in which case its next would be left as undefined.
		head.next = undefined;

		return tail;
	}

	dfs(node: CallGraphNode) {
		// Order doesn't matter.
		node.visitIndex = 1;
		
		for (let neighbor of node.outgoingCalls) {
			if (neighbor.visitIndex == 0) {
				// Neighbor is unvisited, continue search.
				this.dfs(neighbor);
			}
		}

		this.visitStack.pushListEntry(node.componentList);
	}
}

export class CallGraphNodeSerializable {
	fn: vscode.SymbolInformation;
    content: string;
    identifier: string;

	constructor(node: CallGraphNode) {
		this.fn = node.fn;
        this.content = node.content;
        this.identifier = node.identifier;
	}

	toNode(): CallGraphNode {
		return new CallGraphNode(this.fn, { content: this.content, identifier: this.identifier, });
	}
}
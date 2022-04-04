class HeapElement<T> {
    key: number;
    value: T;
    constructor(key: number, value: T) {
        this.key = key;
        this.value = value;
    }

    gt(other: HeapElement<T>): boolean {
        return this.key > other.key;
    }

    leq(other: HeapElement<T>): boolean {
        return this.key <= other.key;
    }

}

// Min heap, ie parent < children.
class Heap<T> {
    maxElements: number;
    heapArray: Array<HeapElement<T>>;

    constructor(maxElements: number) {
        this.maxElements = maxElements;
        this.heapArray = [];
    }

    left(index: number) {
        return 2*index + 1;
    }

    right(index: number) {
        return 2*index + 2;
    }

    parent(index: number) {
        return (index-1)/2;
    }

    insert(key: number, value: T): boolean {
        if (this.heapArray.length == this.maxElements) {
            return false;
        }

        let i = this.heapArray.length;
        let parent = this.parent(i);

        this.heapArray.push(new HeapElement(key, value));

        // Maintain heap property, sift up
        while (i != 0 && this.heapArray[parent].gt(this.heapArray[i])) {
            let tmp = this.heapArray[parent];
            this.heapArray[parent] = this.heapArray[i];
            this.heapArray[i] = tmp;

            i = parent;
            parent = this.parent(i);
        }
        return true;
    }

    extractMax(): T | undefined {
        if (this.heapArray.length > 1)
            return this.heapArray.pop()?.value;
        return undefined;
    }

    extractMin(): T | undefined {
        if (this.heapArray.length == 0) {
            return undefined;
        }

        let root = this.heapArray[0];
        let max = this.heapArray.pop()!!;

        if (this.heapArray.length == 0) {
            return root.value;
        }

        this.heapArray[0] = max;

        this.siftDown(0);
        return root.value;
    }

    siftDown(index: number) {
        let l = this.left(index);
        let r = this.right(index);
        let smallest = index;

        // both l and r sub trees are heaps. If index is not a heap, then swap
        // index with a child and recurse down until smallest is index in which case
        // index is a heap.
        // Swapping and with the smallest guarantees the sub tree we're not recursing down
        // is still a heap.

        // If smallest isn't index, then 
        if (l < this.heapArray.length && this.heapArray[smallest].gt(this.heapArray[l])) {
            smallest = l;
        }

        if (r < this.heapArray.length && this.heapArray[smallest].gt(this.heapArray[r])) {
            smallest = r;
        }

        if (smallest != index) {
            let tmp = this.heapArray[smallest];
            this.heapArray[smallest] = this.heapArray[index];
            this.heapArray[index] = tmp;
            this.siftDown(smallest);
        }
    }

    findMin(): T | undefined {
        if (this.heapArray.length > 1)
            return this.heapArray[0].value;
        return undefined;
    }
}
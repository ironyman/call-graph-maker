import * as vscode from 'vscode';
import { getCurrentFunction } from './functiontracker';
import { DbgChannel, assert } from './debug';

function getCurrentWord(te: vscode.TextEditor): [number, number, string] {
    let text = te.document.getText();
    let cursor = te.document.offsetAt(te.selection.active);

    let startWord = 0;
    let endWord = 0;
    
    while (cursor > 0) {
        if (!text[cursor - 1].match(/\w/)) {
            break;
        }
        --cursor;
    }
    startWord = cursor;

    while (cursor < text.length) {
        if (!text[cursor].match(/\w/)) {
            break;
        }
        ++cursor;
    }
    endWord = cursor;

    return [startWord, endWord, text.substring(startWord, endWord)];
}

async function gotoInEditor(te: vscode.TextEditor, index: number) {
    let target = te.document.positionAt(index);
    te.selection = new vscode.Selection(target.line, target.character, target.line, target.character);
    te.revealRange(te.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export async function gotoLocalDefinition(te: vscode.TextEditor) {
    let currentFunction = await getCurrentFunction();
    if (!currentFunction) {
        return;
    }

    // let [startWord, endWord, currentWord] = getCurrentWord(te);
    let currentWordRange = te.document.getWordRangeAtPosition(te.selection.active);
    let startWord = te.document.offsetAt(currentWordRange!!.start);
    let currentWord = te.document.getText(currentWordRange!!);

    let functionStart = te.document.offsetAt(currentFunction.location.range.start);

    let text = te.document.getText();

    let foundFirst = text.indexOf(currentWord, functionStart);
    if (foundFirst < startWord) {
        await gotoInEditor(te, foundFirst);
    } else {
        vscode.window.showWarningMessage("Definition not found");
    }
}

export async function gotoReferenceInFunction(referent: string, containingFunction: vscode.SymbolInformation) {
    let doc, te;
    if (containingFunction.location.uri.fsPath === 'function') {
        doc = await vscode.workspace.openTextDocument(containingFunction.location.uri);
        te = await vscode.window.showTextDocument(doc);
    } else {
        // After deserializing those APIs above like to fail
        let newUri = vscode.Uri.file(containingFunction.location.uri.path);
        doc = await vscode.workspace.openTextDocument(newUri);
        te = await vscode.window.showTextDocument(doc);
    }

    let functionStart, functionEnd;
    try {
        functionStart = doc.offsetAt(containingFunction.location.range.start);
        functionEnd = doc.offsetAt(containingFunction.location.range.end);
    } catch {
        // These types don't work after deserializing...
        let temp = containingFunction.location.range as any;
        functionStart = doc.offsetAt(new vscode.Position(temp[0].line, temp[0].character));
        functionEnd = doc.offsetAt(new vscode.Position(temp[1].line, temp[1].character));
    }

    let cursorPos = te.document.offsetAt(te.selection.active);
    let searchStart = functionStart;

    if (cursorPos > functionStart && cursorPos < functionEnd) {
        searchStart = cursorPos + 1;
    }

    let text = doc.getText();
    let found = text.indexOf(referent, searchStart);

    if (found < functionStart || found > functionEnd) {
        found = text.indexOf(referent, functionStart);
    }

    if (found > functionStart && found < functionEnd) {
        await gotoInEditor(te, found);
    } else {
        vscode.window.showWarningMessage("Reference not found");
    }
}
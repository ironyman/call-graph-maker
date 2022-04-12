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
        let target = te.document.positionAt(foundFirst);
        te.selection = new vscode.Selection(target.line, target.character, target.line, target.character);
        te.revealRange(te.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } else {
        vscode.window.showWarningMessage("Definition not found");
    }
}
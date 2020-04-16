import * as vscode from "vscode";
import {
	detectBoxScriptsForFolder, findScriptAtPosition, runScript, FolderTaskItem
} from "./tasks";

export function runSelectedScript() {
	const editor = vscode.window.activeTextEditor;
	if ( !editor ) {
		return;
	}
	const document = editor.document;
	const contents = document.getText();
	const selection = editor.selection;
	const offset = document.offsetAt( selection.anchor );

	const script = findScriptAtPosition( contents, offset );
	if ( script ) {
		runScript( script, document );
	} else {
		const message = "Could not find a valid CommandBox script at the selection.";
		vscode.window.showErrorMessage( message );
	}
}

export async function selectAndRunScriptFromFolder( selectedFolder: vscode.Uri ) {
	const taskList: FolderTaskItem[] = await detectBoxScriptsForFolder( selectedFolder );

	if ( taskList?.length > 0 ) {
		const quickPick = vscode.window.createQuickPick<FolderTaskItem>();
		quickPick.title = "Run CommandBox script in Folder";
		quickPick.placeholder = "Select a CommandBox script";
		quickPick.items = taskList;

		const toDispose: vscode.Disposable[] = [];

		const pickPromise = new Promise<FolderTaskItem | undefined>( ( c ) => {
			toDispose.push( quickPick.onDidAccept( () => {
				toDispose.forEach( d => d.dispose() );
				c( quickPick.selectedItems[0] );
			} ) );
			toDispose.push( quickPick.onDidHide( () => {
				toDispose.forEach( d => d.dispose() );
				c( undefined );
			} ) );
		} );
		quickPick.show();
		const result = await pickPromise;
		quickPick.dispose();
		if ( result ) {
			vscode.tasks.executeTask( result.task );
		}
	} else {
		vscode.window.showInformationMessage( `No CommandBox scripts found in ${selectedFolder.fsPath}`, { modal: true } );
	}
}

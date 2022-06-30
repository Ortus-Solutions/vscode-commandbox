import * as vscode from "vscode";
import {
	detectBoxScriptsForFolder, findScriptAtPosition, runScript, FolderTaskItem
} from "./tasks";

export function runSelectedScript( context: vscode.ExtensionContext ): void {
	const editor = vscode.window.activeTextEditor;
	if ( !editor ) {
		return;
	}
	const document = editor.document;
	const contents = document.getText();
	const script = findScriptAtPosition( editor.document, contents, editor.selection.anchor );
	if ( script ) {
		runScript( context, script, document );
	} else {
		const message = "Could not find a valid CommandBox script at the selection.";
		vscode.window.showErrorMessage( message );
	}
}

export async function selectAndRunScriptFromFolder( context: vscode.ExtensionContext, selectedFolders: vscode.Uri[] ): Promise<void> {
	if ( selectedFolders.length === 0 ) {
		return;
	}
	const selectedFolder = selectedFolders[0];

	const taskList: FolderTaskItem[] = await detectBoxScriptsForFolder( context, selectedFolder );

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

export async function turnAutoDetectOn(): Promise<void> {
	const commandboxSettings = vscode.workspace.getConfiguration( "commandbox", null );
	await commandboxSettings.update( "autoDetect", "on" );
	vscode.commands.executeCommand( "commandbox.refresh" );
}

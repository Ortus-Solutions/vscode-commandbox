import * as httpRequest from "request-light";
import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { addJSONProviders } from "./features/jsonContributions";
import { runSelectedScript, selectAndRunScriptFromFolder } from "./commands";
import { BoxScriptsTreeDataProvider } from "./commandboxView";
import { invalidateTasksCache, BoxTaskProvider, hasBoxJson } from "./tasks";
import { invalidateHoverScriptsCache, BoxScriptHoverProvider } from "./scriptHover";

let treeDataProvider: BoxScriptsTreeDataProvider | undefined;
const octokit = new Octokit();
const httpSuccessStatusCode: number = 200;

/**
 * Gets the latest CommandBox Server schema from the CommandBox git repository
 */
async function getLatestServerSchema( context: vscode.ExtensionContext ): Promise<void> {
	const serverSchemaFileName: string = "server.schema.json";
	const serverSchemaFilePath: string = path.join( context.extensionPath, "resources", "schemas", serverSchemaFileName );

	try {
		const serverSchemaResult = await octokit.repos.getContents( {
			owner : "Ortus-Solutions",
			repo  : "commandbox",
			path  : `src/cfml/system/config/${serverSchemaFileName}`,
			ref   : "master"
		} );

		if ( serverSchemaResult?.status === httpSuccessStatusCode && !Array.isArray( serverSchemaResult.data ) && serverSchemaResult.data.type === "file" ) {
			const resultText: string = Buffer.from( serverSchemaResult.data.content, <BufferEncoding>serverSchemaResult.data.encoding ).toString( "utf8" );

			fs.writeFileSync( serverSchemaFilePath, resultText );
		}
	} catch ( err ) {
		console.error( err );
	}
}

/**
 * Gets the latest Box schema from the CommandBox git repository
 */
async function getLatestBoxSchema( context: vscode.ExtensionContext ): Promise<void> {
	const boxSchemaFileName: string = "box.schema.json";
	const boxSchemaFilePath: string = path.join( context.extensionPath, "resources", "schemas", boxSchemaFileName );

	try {
		const boxSchemaResult = await octokit.repos.getContents( {
			owner : "Ortus-Solutions",
			repo  : "commandbox",
			path  : `src/cfml/system/config/${boxSchemaFileName}`,
			ref   : "master"
		} );

		if ( boxSchemaResult?.status === httpSuccessStatusCode && !Array.isArray( boxSchemaResult.data ) && boxSchemaResult.data.type === "file" ) {
			const resultText: string = Buffer.from( boxSchemaResult.data.content, <BufferEncoding>boxSchemaResult.data.encoding ).toString( "utf8" );

			fs.writeFileSync( boxSchemaFilePath, resultText );
		}
	} catch ( err ) {
		console.error( err );
	}
}

export async function activate( context: vscode.ExtensionContext ): Promise<void> {
	registerTaskProvider( context );
	treeDataProvider = registerExplorer( context );
	registerScriptHoverProvider( context );

	getLatestServerSchema( context );
	getLatestBoxSchema( context );

	configureHttpRequest();
	let d = vscode.workspace.onDidChangeConfiguration( ( e ) => {
		configureHttpRequest();
		if ( e.affectsConfiguration( "commandbox.exclude" ) || e.affectsConfiguration( "commandbox.autoDetect" ) ) {
			invalidateTasksCache();
			if ( treeDataProvider ) {
				treeDataProvider.refresh();
			}
		}
		if ( e.affectsConfiguration( "commandbox.scriptExplorerAction" ) ) {
			if ( treeDataProvider ) {
				treeDataProvider.refresh();
			}
		}
	} );
	context.subscriptions.push( d );

	d = vscode.workspace.onDidChangeTextDocument( ( e ) => {
		invalidateHoverScriptsCache( e.document );
	} );
	context.subscriptions.push( d );
	context.subscriptions.push( vscode.commands.registerCommand( "commandbox.runSelectedScript", runSelectedScript ) );
	context.subscriptions.push( addJSONProviders( httpRequest.xhr ) );

	if ( await hasBoxJson() ) {
		vscode.commands.executeCommand( "setContext", "commandbox:showScriptExplorer", true );
	}

	context.subscriptions.push( vscode.commands.registerCommand( "commandbox.runScriptFromFolder", selectAndRunScriptFromFolder ) );
}

function registerTaskProvider( context: vscode.ExtensionContext ): vscode.Disposable | undefined {

	function invalidateScriptCaches() {
		invalidateHoverScriptsCache();
		invalidateTasksCache();
		if ( treeDataProvider ) {
			treeDataProvider.refresh();
		}
	}

	if ( vscode.workspace.workspaceFolders ) {
		const watcher = vscode.workspace.createFileSystemWatcher( "**/box.json" );
		watcher.onDidChange( ( _e ) => invalidateScriptCaches() );
		watcher.onDidDelete( ( _e ) => invalidateScriptCaches() );
		watcher.onDidCreate( ( _e ) => invalidateScriptCaches() );
		context.subscriptions.push( watcher );

		const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders( ( _e ) => invalidateScriptCaches() );
		context.subscriptions.push( workspaceWatcher );

		const provider: vscode.TaskProvider = new BoxTaskProvider();
		const disposable = vscode.tasks.registerTaskProvider( "commandbox", provider );
		context.subscriptions.push( disposable );
		return disposable;
	}
	return undefined;
}

function registerExplorer( context: vscode.ExtensionContext ): BoxScriptsTreeDataProvider | undefined {
	if ( vscode.workspace.workspaceFolders ) {
		const treeDataProvider = new BoxScriptsTreeDataProvider( context );
		const view = vscode.window.createTreeView( "commandbox", { treeDataProvider: treeDataProvider, showCollapseAll: true } );
		context.subscriptions.push( view );
		return treeDataProvider;
	}
	return undefined;
}

function registerScriptHoverProvider( context: vscode.ExtensionContext ): BoxScriptHoverProvider | undefined {
	if ( vscode.workspace.workspaceFolders ) {
		const boxSelector: vscode.DocumentSelector = {
			language : "json",
			scheme   : "file",
			pattern  : "**/box.json"
		};
		const provider = new BoxScriptHoverProvider( context );
		context.subscriptions.push( vscode.languages.registerHoverProvider( boxSelector, provider ) );
		return provider;
	}
	return undefined;
}

function configureHttpRequest() {
	const httpSettings = vscode.workspace.getConfiguration( "http" );
	httpRequest.configure( httpSettings.get<string>( "proxy", "" ), httpSettings.get<boolean>( "proxyStrictSSL", true ) );
}

export function deactivate(): void {
}

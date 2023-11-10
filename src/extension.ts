import * as httpRequest from "request-light";
import { Octokit } from "@octokit/rest";
import * as vscode from "vscode";
import { addJSONProviders } from "./features/jsonContributions";
import { runSelectedScript, selectAndRunScriptFromFolder, turnAutoDetectOn } from "./commands";
import { BoxScriptsTreeDataProvider } from "./commandboxView";
import { invalidateTasksCache, BoxTaskProvider, hasBoxJson } from "./tasks";
import { invalidateHoverScriptsCache, BoxScriptHoverProvider } from "./scriptHover";
import { decorateBoxJSON } from "./features/boxJSONDecorations";

let treeDataProvider: BoxScriptsTreeDataProvider | undefined;
const octokit = new Octokit();
const gitRepoInfo = {
	owner      : "Ortus-Solutions",
	repo       : "commandbox",
	prodBranch : "master"
};
const httpSuccessStatusCode = 200;

function invalidateScriptCaches(): void {
	invalidateHoverScriptsCache();
	invalidateTasksCache();
	if ( treeDataProvider ) {
		treeDataProvider.refresh();
	}
}

/**
 * Gets the latest CommandBox Server schema from the CommandBox git repository
 */
async function getLatestServerSchema( context: vscode.ExtensionContext ): Promise<void> {
	const serverSchemaFileName = "server.schema.json";

	try {
		const serverSchemaResult = await octokit.repos.getContent( {
			owner : gitRepoInfo.owner,
			repo  : gitRepoInfo.repo,
			path  : `src/cfml/system/config/${serverSchemaFileName}`,
			ref   : gitRepoInfo.prodBranch
		} );

		if ( serverSchemaResult?.status === httpSuccessStatusCode && !Array.isArray( serverSchemaResult.data ) && serverSchemaResult.data.type === "file" ) {
			const result = Buffer.from( serverSchemaResult.data["content"], serverSchemaResult.data["encoding"] as BufferEncoding );
			const serverSchemaFileUri = vscode.Uri.joinPath( context.extensionUri, "resources", "schemas", serverSchemaFileName );

			await vscode.workspace.fs.writeFile( serverSchemaFileUri, result );
		}
	} catch ( err ) {
		console.error( err );
	}
}

/**
 * Gets the latest Box schema from the CommandBox git repository
 */
async function getLatestBoxSchema( context: vscode.ExtensionContext ): Promise<void> {
	const boxSchemaFileName = "box.schema.json";

	try {
		const boxSchemaResult = await octokit.repos.getContent( {
			owner : gitRepoInfo.owner,
			repo  : gitRepoInfo.repo,
			path  : `src/cfml/system/config/${boxSchemaFileName}`,
			ref   : gitRepoInfo.prodBranch
		} );

		if ( boxSchemaResult?.status === httpSuccessStatusCode && !Array.isArray( boxSchemaResult.data ) && boxSchemaResult.data.type === "file" ) {
			const result = Buffer.from( boxSchemaResult.data["content"], boxSchemaResult.data["encoding"] as BufferEncoding );
			const boxSchemaFileUri = vscode.Uri.joinPath( context.extensionUri, "resources", "schemas", boxSchemaFileName );

			await vscode.workspace.fs.writeFile( boxSchemaFileUri, result );
		}
	} catch ( err ) {
		console.error( err );
	}
}

export async function activate( context: vscode.ExtensionContext ): Promise<void> {
	configureHttpRequest();
	context.subscriptions.push( vscode.workspace.onDidChangeConfiguration( e => {
		if ( e.affectsConfiguration( "http.proxy" ) || e.affectsConfiguration( "http.proxyStrictSSL" ) ) {
			configureHttpRequest();
		}
	} ) ) ;

	context.subscriptions.push( addJSONProviders( httpRequest.xhr ) );

	registerTaskProvider( context );

	treeDataProvider = registerExplorer( context );

	getLatestServerSchema( context );
	getLatestBoxSchema( context );

	context.subscriptions.push( vscode.workspace.onDidChangeConfiguration( ( e ) => {
		if ( e.affectsConfiguration( "commandbox.exclude" ) || e.affectsConfiguration( "commandbox.autoDetect" )|| e.affectsConfiguration( "commandbox.scriptExplorerExclude" ) ) {
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
	} ) );

	registerScriptHoverProvider( context );



	context.subscriptions.push( vscode.commands.registerCommand( "commandbox.runSelectedScript", runSelectedScript ) );

	if ( await hasBoxJson() ) {
		vscode.commands.executeCommand( "setContext", "commandbox:showScriptExplorer", true );
	}

	context.subscriptions.push( vscode.commands.registerCommand( "commandbox.runScriptFromFolder", selectAndRunScriptFromFolder ) );

	context.subscriptions.push( vscode.commands.registerCommand( "commandbox.autoDetectOn", turnAutoDetectOn ) );

	context.subscriptions.push( vscode.commands.registerCommand( "commandbox.refresh", () => {
		invalidateScriptCaches();
	} ) ) ;

	context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor( ( textEditor: vscode.TextEditor ) => decorateBoxJSON( textEditor ) ) );
	context.subscriptions.push( vscode.window.onDidChangeActiveTextEditor( ( textEditor: vscode.TextEditor ) => decorateBoxJSON( textEditor ) ) );

	let timeout = null;
	context.subscriptions.push( vscode.workspace.onDidChangeTextDocument( ( event: vscode.TextDocumentChangeEvent ) => {
		const textEditor = vscode.window.visibleTextEditors.find( te => te.document === event.document );

		if( !textEditor ){
			return;
		}

		clearTimeout(timeout)
		timeout = setTimeout(() => {
			decorateBoxJSON( textEditor );
		}, 500)
	}));

	vscode.window.visibleTextEditors.forEach( (textEditor:vscode.TextEditor) => {
		decorateBoxJSON( textEditor );
	});
}

let taskProvider: BoxTaskProvider;
function registerTaskProvider( context: vscode.ExtensionContext ): vscode.Disposable | undefined {
	if ( vscode.workspace.workspaceFolders ) {
		const watcher = vscode.workspace.createFileSystemWatcher( "**/box.json" );
		watcher.onDidChange( ( _e ) => invalidateScriptCaches() );
		watcher.onDidDelete( ( _e ) => invalidateScriptCaches() );
		watcher.onDidCreate( ( _e ) => invalidateScriptCaches() );
		context.subscriptions.push( watcher );

		const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders( ( _e ) => invalidateScriptCaches() );
		context.subscriptions.push( workspaceWatcher );

		taskProvider = new BoxTaskProvider( context );
		const disposable = vscode.tasks.registerTaskProvider( "commandbox", taskProvider );
		context.subscriptions.push( disposable );
		return disposable;
	}
	return undefined;
}

function registerExplorer( context: vscode.ExtensionContext ): BoxScriptsTreeDataProvider | undefined {
	if ( vscode.workspace.workspaceFolders ) {
		const treeDataProvider = new BoxScriptsTreeDataProvider( context, taskProvider! );
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

function configureHttpRequest(): void {
	const httpSettings = vscode.workspace.getConfiguration( "http" );
	const proxyUrl = httpSettings.get<string>( "proxy", "" );
	const strictSSL = httpSettings.get<boolean>( "proxyStrictSSL", true );

	httpRequest.configure( proxyUrl, strictSSL );

	if ( proxyUrl ) {
		// TODO: Configure Octokit for proxy
	}
}

export function deactivate(): void {
}

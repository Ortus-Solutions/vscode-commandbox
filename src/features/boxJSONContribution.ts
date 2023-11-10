import { MarkdownString, CompletionItemKind, CompletionItem, DocumentSelector, SnippetString, workspace, Uri } from "vscode";
import { IJSONContribution, ISuggestionsCollector } from "./jsonContributions";
import { XHRRequest } from "request-light";
import { Location } from "jsonc-parser";
import * as forgeboxAPI from "../forgeboxAPI";

const LIMIT = 50;
const USER_AGENT = "Visual Studio Code";
const httpSuccessStatusCode = 200;

export class BoxJSONContribution implements IJSONContribution {

	private mostDependedOn = [
		"testbox", "coldbox", "cbjavaloader", "cbi18n", "cbvalidation", "cborm", "FusionReactor", "cbsecurity", "qb", "propertyFile",
		"commandbox-cfconfig", "commandbox-docbox", "cbstreams", "presidecms", "cbstorages", "semver", "cbmarkdown"
	];

	public getDocumentSelector(): DocumentSelector {
		return [ { language: "json", scheme: "*", pattern: "**/box.json" } ];
	}

	public constructor( private xhr: XHRRequest ) {
		this.xhr = xhr;
	}

	public async collectDefaultSuggestions( _resource: Uri, result: ISuggestionsCollector ): Promise<null> {
		const defaultValue = {
			"name"             : "${1:name}",
			"slug"             : "${2:slug}",
			"shortDescription" : "${3:shortDescription}",
			"author"           : "${4:author}",
			"version"          : "${5:1.0.0}",
			"dependencies"     : {}
		};
		const proposal = new CompletionItem( "Default box.json", CompletionItemKind.Module );
		proposal.insertText = new SnippetString( JSON.stringify( defaultValue, null, "\t" ) );
		result.add( proposal );
		return null;
	}

	private onlineEnabled(): boolean {
		return !!workspace.getConfiguration( "commandbox.forgebox" ).get( "fetchOnlinePackageInfo" );
	}

	public async collectPropertySuggestions(
		_resource: Uri,
		location: Location,
		currentWord: string,
		addValue: boolean,
		isLast: boolean,
		collector: ISuggestionsCollector
	): Promise<any> | null {
		if ( !this.onlineEnabled() ) {
			return null;
		}

		if ( ( location.matches( [ "dependencies" ] ) || location.matches( [ "devDependencies" ] ) ) ) {
			if ( currentWord.length > 1 ) {
				let endpointUrl: string = workspace.getConfiguration( "commandbox.forgebox" ).get( "endpointUrl" );
				if ( endpointUrl.endsWith( "/" ) ) {
					endpointUrl = endpointUrl.slice( 0, -1 );
				}
				const queryUrl = `${endpointUrl}/api/v1/entries?max=${LIMIT}&searchTerm=${encodeURIComponent( currentWord )}`;
				// queryUrl = `${endpointUrl}/api/v1/slugs/${encodeURIComponent(currentWord)}`;
				try {
					const success = await this.xhr( {
						url     : queryUrl,
						headers : { agent: USER_AGENT }
					} );
					if ( success.status === httpSuccessStatusCode ) {
						try {
							const obj = JSON.parse( success.responseText );
							if ( obj?.data?.results && Array.isArray( obj.data.results ) ) {
								const results = ( obj.data.results as BoxPackageInfo[] );
								for ( const result of results ) {
									this.processPackage( result, addValue, isLast, collector );
								}
							}
						} catch ( e ) {
							// ignore
						}
						collector.setAsIncomplete();
					} else {
						collector.error( `Request to the ForgeBox repository failed: ${success.responseText}` );
						return 0;
					}
					return undefined;
				} catch ( error ) {
					collector.error( `Request to the ForgeBox repository failed: ${error.responseText}` );
					return 0;
				}
			} else {
				this.mostDependedOn.forEach( ( name ) => {
					const insertText = new SnippetString().appendText( JSON.stringify( name ) );
					if ( addValue ) {
						insertText.appendText( ': "' ).appendTabstop().appendText( '"' );
						if ( !isLast ) {
							insertText.appendText( "," );
						}
					}
					const proposal = new CompletionItem( name, CompletionItemKind.Property );
					proposal.insertText = insertText;
					proposal.filterText = JSON.stringify( name );
					proposal.documentation = "";
					collector.add( proposal );
				} );
				collector.setAsIncomplete();
			}
		}
		return null;
	}

	public async collectValueSuggestions( resource: Uri, location: Location, result: ISuggestionsCollector ): Promise<any> {
		if ( !this.onlineEnabled() ) {
			return null;
		}

		if ( ( location.matches( [ "dependencies", "*" ] ) || location.matches( [ "devDependencies", "*" ] ) ) ) {
			const currentKey = location.path[location.path.length - 1];
			if ( typeof currentKey === "string" ) {
				const info = await this.fetchPackageInfo( currentKey, resource );
				if ( info?.latestVersion?.version ) {
					const latest = info.latestVersion.version;

					let name = JSON.stringify( latest );
					let proposal = new CompletionItem( name, CompletionItemKind.Property );
					proposal.insertText = name;
					proposal.documentation = "The currently latest version of the package";
					result.add( proposal );

					name = JSON.stringify( "^" + latest );
					proposal = new CompletionItem( name, CompletionItemKind.Property );
					proposal.insertText = name;
					proposal.documentation = "Matches the most recent major version (1.x.x)";
					result.add( proposal );

					name = JSON.stringify( "~" + latest );
					proposal = new CompletionItem( name, CompletionItemKind.Property );
					proposal.insertText = name;
					proposal.documentation = "Matches the most recent minor version (1.2.x)";
					result.add( proposal );
				}
			}
		}
		return null;
	}

	private getDocumentation( description: string | undefined, version: string | undefined, homepage: string | undefined ): MarkdownString {
		const str = new MarkdownString();
		if ( description ) {
			str.appendText( description );
		}
		if ( version ) {
			str.appendText( "\n\n" );
			str.appendText( `Latest version: ${version}` );
		}
		if ( homepage ) {
			str.appendText( "\n\n" );
			str.appendText( homepage );
		}

		return str;
	}

	public async resolveSuggestion( resource: Uri | undefined, item: CompletionItem ): Promise<CompletionItem | null> | null {
		if ( item.kind === CompletionItemKind.Property && !item.documentation ) {
			const name = typeof item.label === "string" ? item.label : item.label.label;
			const info = await this.fetchPackageInfo( name, resource );
			if ( info ) {
				item.documentation = this.getDocumentation( info.summary, info.latestVersion?.version, info.homeURL );

				return item;
			}
		}
		return null;
	}

	private async fetchPackageInfo( pack: string, _resource: Uri | undefined ): Promise<BoxPackageInfo | undefined> {
		// TODO: Should check first if pack name is even valid based on ForgeBox rules.

		const info = await forgeboxAPI.getPackageInfo( pack );

		if ( info instanceof forgeboxAPI.ForgeBoxError ) {
			return null;
		}

		return info;
	}

	public async getInfoContribution( resource: Uri, location: Location ): Promise<MarkdownString[] | null> | null {
		if ( ( location.matches( [ "dependencies", "*" ] ) || location.matches( [ "devDependencies", "*" ] ) ) ) {
			const pack = location.path[location.path.length - 1];
			if ( typeof pack === "string" ) {
				const info = await this.fetchPackageInfo( pack, resource );
				if ( info ) {
					return [ this.getDocumentation( info.summary, info.latestVersion?.version, info.homeURL ) ];
				}
			}
		}
		return null;
	}

	private processPackage( pack: BoxPackageInfo, addValue: boolean, isLast: boolean, collector: ISuggestionsCollector ): void {
		if ( pack?.slug ) {
			const name = pack.slug;
			const insertText = new SnippetString().appendText( JSON.stringify( name ) );
			if ( addValue ) {
				insertText.appendText( ': "' );
				if ( pack.latestVersion?.version ) {
					insertText.appendVariable( "version", pack.latestVersion.version );
				} else {
					insertText.appendTabstop();
				}
				insertText.appendText( '"' );
				if ( !isLast ) {
					insertText.appendText( "," );
				}
			}
			const proposal = new CompletionItem( name, CompletionItemKind.Property );
			proposal.insertText = insertText;
			proposal.filterText = JSON.stringify( name );
			proposal.documentation = this.getDocumentation( pack.summary, pack.latestVersion?.version, pack.homeURL );
			collector.add( proposal );
		}
	}
}

interface BoxPackageInfo {
	title: string;
	slug: string;
	isActive: boolean;
	latestVersion: PackageVersion;
	summary?: string;
	homeURL?: string;
}

interface PackageVersion {
	isActive: boolean;
	version: string;
	isStable: boolean;
}

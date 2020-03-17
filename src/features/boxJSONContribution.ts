import { MarkedString, CompletionItemKind, CompletionItem, DocumentSelector, SnippetString, workspace } from "vscode";
import { IJSONContribution, ISuggestionsCollector } from "./jsonContributions";
import { XHRRequest } from "request-light";
import { Location } from "jsonc-parser";
import { textToMarkedString } from "./markedTextUtil";
// import * as cp from "child_process";

const LIMIT = 50;
const USER_AGENT = "Visual Studio Code";
const httpSuccessStatusCode: number = 200;

export class BoxJSONContribution implements IJSONContribution {

	private mostDependedOn = [
		"testbox", "coldbox", "cbjavaloader", "cbi18n", "cbvalidation", "cborm", "FusionReactor", "cbsecurity", "qb", "propertyFile",
		"commandbox-cfconfig", "commandbox-docbox", "cbstreams", "presidecms", "cbstorages", "semver", "cbmarkdown"
	];

	private xhr: XHRRequest;

	public getDocumentSelector(): DocumentSelector {
		return [{ language: "json", scheme: "*", pattern: "**/box.json" }];
	}

	public constructor(xhr: XHRRequest) {
		this.xhr = xhr;
	}

	public async collectDefaultSuggestions(_fileName: string, result: ISuggestionsCollector): Promise<null> {
		const defaultValue = {
			"name": "${1:name}",
			"slug": "${2:slug}",
			"shortDescription": "${3:shortDescription}",
			"author": "${4:author}",
			"version": "${5:1.0.0}",
			"dependencies": {}
		};
		const proposal = new CompletionItem("Default box.json", CompletionItemKind.Module);
		proposal.insertText = new SnippetString(JSON.stringify(defaultValue, null, "\t"));
		result.add(proposal);
		return null;
	}

	private onlineEnabled() {
		return !!workspace.getConfiguration("commandbox.forgebox").get("fetchOnlinePackageInfo");
	}

	public async collectPropertySuggestions(
		_resource: string,
		location: Location,
		currentWord: string,
		addValue: boolean,
		isLast: boolean,
		collector: ISuggestionsCollector
	): Promise<any> | null {
		if (!this.onlineEnabled()) {
			return null;
		}

		if ((location.matches(["dependencies"]) || location.matches(["devDependencies"]))) {
			let queryUrl: string;
			if (currentWord.length > 1) {
				let endpointUrl: string = workspace.getConfiguration("commandbox.forgebox").get("endpointUrl");
				if (endpointUrl.endsWith("/")) {
					endpointUrl = endpointUrl.substr(0, endpointUrl.length-1);
				}
				queryUrl = `${endpointUrl}/api/v1/entries?max=${LIMIT}&searchTerm=${encodeURIComponent(currentWord)}`;
				// queryUrl = `${endpointUrl}/api/v1/slugs/${encodeURIComponent(currentWord)}`;
				try {
					const success = await this.xhr({
						url: queryUrl,
						agent: USER_AGENT
					});
					if (success.status === httpSuccessStatusCode) {
						try {
							const obj = JSON.parse(success.responseText);
							if (obj?.data?.results && Array.isArray(obj.data.results)) {
								const results = (<BoxPackageInfo[]>obj.data.results);
								for (const result of results) {
									this.processPackage(result, addValue, isLast, collector);
								}
								if (results.length >= LIMIT) {
									collector.setAsIncomplete();
								}
							}
						} catch (e) {
							// ignore
						}
					} else {
						collector.error(`Request to the ForgeBox repository failed: ${success.responseText}`);
						return 0;
					}
					return undefined;
				} catch (error) {
					collector.error(`Request to the ForgeBox repository failed: ${error.responseText}`);
					return 0;
				}
			} else {
				this.mostDependedOn.forEach((name) => {
					const insertText = new SnippetString().appendText(JSON.stringify(name));
					if (addValue) {
						insertText.appendText(': "').appendTabstop().appendText('"');
						if (!isLast) {
							insertText.appendText(",");
						}
					}
					const proposal = new CompletionItem(name, CompletionItemKind.Property);
					proposal.insertText = insertText;
					proposal.filterText = JSON.stringify(name);
					proposal.documentation = "";
					collector.add(proposal);
				});
				collector.setAsIncomplete();
			}
		}
		return null;
	}

	public async collectValueSuggestions(_fileName: string, location: Location, result: ISuggestionsCollector): Promise<any> {
		if (!this.onlineEnabled()) {
			return null;
		}

		if ((location.matches(["dependencies", "*"]) || location.matches(["devDependencies", "*"]))) {
			const currentKey = location.path[location.path.length - 1];
			if (typeof currentKey === "string") {
				const info = await this.fetchPackageInfo(currentKey);
				if (info?.latestVersion?.version) {
					const latest = info.latestVersion.version;

					let name = JSON.stringify(latest);
					let proposal = new CompletionItem(name, CompletionItemKind.Property);
					proposal.insertText = name;
					proposal.documentation = "The currently latest version of the package";
					result.add(proposal);

					name = JSON.stringify("^" + latest);
					proposal = new CompletionItem(name, CompletionItemKind.Property);
					proposal.insertText = name;
					proposal.documentation = "Matches the most recent major version (1.x.x)";
					result.add(proposal);

					name = JSON.stringify("~" + latest);
					proposal = new CompletionItem(name, CompletionItemKind.Property);
					proposal.insertText = name;
					proposal.documentation = "Matches the most recent minor version (1.2.x)";
					result.add(proposal);
				}
			}
		}
		return null;
	}

	public async resolveSuggestion(item: CompletionItem): Promise<CompletionItem | null> | null {
		if (item.kind === CompletionItemKind.Property && item.documentation === "") {
			const infos = await this.getInfo(item.label);
			if (infos.length > 0) {
				item.documentation = infos[0];
				if (infos.length > 1) {
					item.detail = infos[1];
				}
				return item;
			}
		}
		return null;
	}

	private async getInfo(pack: string): Promise<string[]> {
		const info = await this.fetchPackageInfo(pack);
		if (info) {
			const result: string[] = [];
			result.push(info.summary || "");
			result.push(info.latestVersion ? `Latest version: ${info.latestVersion.version}` : "");
			result.push(info.homeURL || "");
			return result;
		}

		return [];
	}

	private async fetchPackageInfo(pack: string): Promise<BoxPackageInfo | undefined> {
		let info = await this.forgeboxView(pack);
		if (!info) {
			// info = await this.commandboxView(pack);
		}
		return info;
	}

	private async forgeboxView(pack: string): Promise<BoxPackageInfo | undefined> {
		let endpointUrl: string = workspace.getConfiguration("commandbox.forgebox").get("endpointUrl");
		if (endpointUrl.endsWith("/")) {
			endpointUrl = endpointUrl.substr(0, endpointUrl.length-1);
		}
		const queryUrl = `${endpointUrl}/api/v1/entry/${encodeURIComponent(pack)}`;
		try {
			const success = await this.xhr({
				url: queryUrl,
				agent: USER_AGENT
			});
			if (success.status === httpSuccessStatusCode) {
				const obj = JSON.parse(success.responseText);
				if (obj?.data) {
					return <BoxPackageInfo>obj.data;
				}
			}
		} catch (error) {
			// ignore
		}

		return undefined;
	}

	/*
	private async commandboxView(pack: string): Promise<BoxPackageInfo | undefined> {
		return new Promise((resolve, _reject) => {
			const command = "box show --json " + pack;
			cp.exec(command, (error, stdout) => {
				if (!error) {
					try {
						resolve(<BoxPackageInfo>JSON.parse(stdout));
					} catch (e) {
						// ignore
					}
				}
				resolve(undefined);
			});
		});
	}
	*/

	public async getInfoContribution(_fileName: string, location: Location): Promise<MarkedString[] | null> | null {
		if ((location.matches(["dependencies", "*"]) || location.matches(["devDependencies", "*"]))) {
			const pack = location.path[location.path.length - 1];
			if (typeof pack === "string") {
				const infos = await this.getInfo(pack);
				if (infos.length) {
					return [infos.map(textToMarkedString).join("\n\n")];
				}
			}
		}
		return null;
	}

	private processPackage(pack: BoxPackageInfo, addValue: boolean, isLast: boolean, collector: ISuggestionsCollector): void {
		if (pack?.slug) {
			const name = pack.slug;
			const insertText = new SnippetString().appendText(JSON.stringify(name));
			if (addValue) {
				insertText.appendText(': "');
				if (pack.latestVersion?.version) {
					insertText.appendVariable("version", pack.latestVersion.version);
				} else {
					insertText.appendTabstop();
				}
				insertText.appendText('"');
				if (!isLast) {
					insertText.appendText(",");
				}
			}
			const proposal = new CompletionItem(name, CompletionItemKind.Property);
			proposal.insertText = insertText;
			proposal.filterText = JSON.stringify(name);
			proposal.documentation = pack.summary || "";
			collector.add(proposal);
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

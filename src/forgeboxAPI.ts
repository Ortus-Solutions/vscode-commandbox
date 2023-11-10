import * as httpRequest from "request-light";
import * as vscode from "vscode";

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

export class ForgeBoxError extends Error {
    url: string;
    response: httpRequest.XHRResponse;

    constructor( message: string, url: string, response?: httpRequest.XHRResponse ){
        super( message );

        this.url = url;
        this.response = response;
    }
}

const USER_AGENT = "Visual Studio Code";
const httpSuccessStatusCode = 200;

configureXHR();


export async function getPackageInfo( packageName: string ): Promise<BoxPackageInfo | ForgeBoxError> {
    const queryUrl = `${getEndpointURL()}/api/v1/entry/${encodeURIComponent( packageName )}`;
    try{
        const response = await httpRequest.xhr( {
            url     : queryUrl,
            headers : { agent: USER_AGENT }
        } );

        if ( response.status !== httpSuccessStatusCode ) {
            return new ForgeBoxError( `Request for package ${packageName} was unsuccessful`, queryUrl, response );
        }

        const obj = JSON.parse( response.responseText );
        if ( !obj?.data ) {
            return new ForgeBoxError( `Invalid API response for package ${packageName}`, queryUrl, response );
        }

        return obj.data as BoxPackageInfo;
    }
    catch( e ){
        return new ForgeBoxError( e.message, queryUrl );
    }
}

function getEndpointURL() {
    let endpointUrl: string = vscode.workspace.getConfiguration( "commandbox.forgebox" ).get( "endpointUrl" );

    return endpointUrl.endsWith( "/" ) ? endpointUrl = endpointUrl.slice( 0, -1 ) : endpointUrl;
}

function configureXHR(): void {
	const httpSettings = vscode.workspace.getConfiguration( "http" );
	const proxyUrl = httpSettings.get<string>( "proxy", "" );
	const strictSSL = httpSettings.get<boolean>( "proxyStrictSSL", true );

	httpRequest.configure( proxyUrl, strictSSL );
}
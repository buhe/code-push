import * as base64 from "base-64";
import Q = require("q");
import tryJSON = require("try-json");
import Promise = Q.Promise;
import request = require("superagent");
import * as uuid from "node-uuid";

declare var fs: any;

if (typeof window === "undefined") {
    fs = require("fs");
} else {
    fs = {
        createReadStream: (fileOrPath: string): void => {
            throw new Error("Tried to call a node fs function from the browser.");
        }
    }
}

import { AccessKey, Account, App, Deployment, DeploymentKey, Package } from "rest-definitions";
export { AccessKey, Account, App, Deployment, DeploymentKey, Package };

export interface CodePushError {
    message?: string;
    statusCode?: number;
}

interface PackageToUpload {
    label: string;
    description: string;
    appVersion: string;
    isMandatory: boolean;
}

interface ILoginInfo {
    accessKeyName: string;
    providerName: string;
    providerUniqueId: string;
}

export class AccountManager {
    private _authedAgent: request.SuperAgent<any>;
    private _saveAuthedAgent: boolean = false;

    public account: Account;
    public serverUrl: string = "http://localhost:3000";

    public get accountId(): string {
        return this.account.id;
    }

    constructor(serverUrl?: string) {
        // If window is not defined, it means we are in the node environment and not a browser.
        this._saveAuthedAgent = (typeof window === "undefined");

        this.serverUrl = serverUrl;
    }

    public loginWithAccessToken(accessToken: string): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var loginInfo: ILoginInfo = AccountManager.getLoginInfo(accessToken);

            if (!loginInfo || !loginInfo.providerName || !loginInfo.providerUniqueId) {
                reject(<CodePushError>{ message: "Invalid access key." });
                return;
            }

            var req = request.post(this.serverUrl + "/auth/login/accessToken");

            this.attachCredentials(req, request);

            req.type("form")
                .send({ identity: JSON.stringify({ providerName: loginInfo.providerName, providerUniqueId: loginInfo.providerUniqueId }) })
                .send({ token: loginInfo.accessKeyName })
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (this._saveAuthedAgent) {
                        this._authedAgent = request.agent();
                        this._authedAgent.saveCookies(res);
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public logout(): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var req = request.post(this.serverUrl + "/auth/logout");
            this.attachCredentials(req, request);

            req.end((err: any, res: request.Response) => {
                    if (err && err.status !== 401) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    this._authedAgent = null;

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public isAuthenticated(): Promise<boolean> {
        return Promise<boolean>((resolve, reject, notify) => {
            var requester: request.SuperAgent<any> = this._authedAgent ? this._authedAgent : request;
            var req = requester.get(this.serverUrl + "/authenticated");
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err && err.status !== 401) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var status: number = res ? res.status : err.status;

                    var authenticated: boolean = status === 200;

                    if (authenticated && this._saveAuthedAgent) {
                        this._authedAgent = request.agent();
                        this._authedAgent.saveCookies(res);
                    }

                    resolve(authenticated);
                });
        });
    }

    public addAccessKey(description?: string): Promise<AccessKey> {
        return Promise<AccessKey>((resolve, reject, notify) => {
            var accessKey: AccessKey = { id: null, name: uuid.v4(), description: description };
            var requester: request.SuperAgent<any> = this._authedAgent ? this._authedAgent : request;
            var req = requester.post(this.serverUrl + "/accessKeys/");

            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(accessKey))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        var location = res.header["location"];
                        if (location && location.lastIndexOf("/") !== -1) {
                            accessKey.id = location.substr(location.lastIndexOf("/") + 1);
                            resolve(accessKey);
                        } else {
                            resolve(null);
                        }
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public getAccessKey(accessKeyId: string): Promise<AccessKey> {
        return Promise<AccessKey>((resolve, reject, notify) => {
            var requester: request.SuperAgent<any> = this._authedAgent ? this._authedAgent : request;
            var req = requester.get(this.serverUrl + "/accessKeys/" + accessKeyId);

            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.accessKey);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public getAccessKeys(): Promise<AccessKey[]> {
        return Promise<AccessKey[]>((resolve, reject, notify) => {
            var requester: request.SuperAgent<any> = this._authedAgent ? this._authedAgent : request;
            var req = requester.get(this.serverUrl + "/accessKeys");

            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.accessKeys);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public removeAccessKey(accessKeyId: string): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var requester: request.SuperAgent<any> = this._authedAgent ? this._authedAgent : request;
            var req = requester.del(this.serverUrl + "/accessKeys/" + accessKeyId);

            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    // Account
    public getAccountInfo(): Promise<Account> {
        return Promise<Account>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);

            var req = requester.get(this.serverUrl + "/account");
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);

                    if (res.ok) {
                        if (body) {
                            this.account = <Account>body.account;
                            resolve(this.account);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public updateAccountInfo(accountInfoToChange: Account): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);

            var req = requester.put(this.serverUrl + "/account");
            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(accountInfoToChange))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    // Apps
    public getApps(): Promise<App[]> {
        return Promise<App[]>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);

            var req = requester.get(this.serverUrl + "/apps");
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.apps);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public getApp(appId: string): Promise<App> {
        return Promise<App>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);

            var req = requester.get(this.serverUrl + "/apps/" + appId);
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.app);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public addApp(appName: string, description?: string): Promise<App> {
        return Promise<App>((resolve, reject, notify) => {
            var app = <App>{ name: appName, description: description };
            var requester = (this._authedAgent ? this._authedAgent : request);

            var req = requester.post(this.serverUrl + "/apps/");
            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(app))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        var location = res.header["location"];
                        if (location && location.lastIndexOf("/") !== -1) {
                            app.id = location.substr(location.lastIndexOf("/") + 1);
                            resolve(app);
                        } else {
                            resolve(null);
                        }
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public removeApp(app: App | string): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var id: string = (typeof app === "string") ? app : app.id;
            var requester = (this._authedAgent ? this._authedAgent : request);

            var req = requester.del(this.serverUrl + "/apps/" + id);
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public updateApp(infoToChange: App): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.put(this.serverUrl + "/apps/" + infoToChange.id);
            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(infoToChange))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    // Deployments
    public addDeployment(appId: string, name: string, description?: string): Promise<Deployment> {
        return Promise<Deployment>((resolve, reject, notify) => {
            var deployment = <Deployment>{ name: name, description: description };

            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.post(this.serverUrl + "/apps/" + appId + "/deployments/");;
            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(deployment))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        var location = res.header["location"];
                        if (location && location.lastIndexOf("/") !== -1) {
                            deployment.id = location.substr(location.lastIndexOf("/") + 1);
                            resolve(deployment);
                        } else {
                            resolve(null);
                        }
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public getDeployments(appId: string): Promise<Deployment[]> {
        return Promise<Deployment[]>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.get(this.serverUrl + "/apps/" + appId + "/deployments");
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.deployments);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public getDeployment(appId: string, deploymentId: string) {
        return Promise<Deployment>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.get(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId);
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.deployment);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public updateDeployment(appId: string, infoToChange: Deployment): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.put(this.serverUrl + "/apps/" + appId + "/deployments/" + infoToChange.id);
            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(infoToChange))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public removeDeployment(appId: string, deployment: Deployment | string): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var id: string = (typeof deployment === "string") ? deployment : deployment.id;
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.del(this.serverUrl + "/apps/" + appId + "/deployments/" + id);
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    // Deployment key
    public addDeploymentKey(appId: string, deploymentId: string, name: string, description?: string): Promise<DeploymentKey> {
        return Promise<DeploymentKey>((resolve, reject, notify) => {
            var deploymentKey: DeploymentKey = this.generateDeploymentKey(name, description, /*isPrimary*/ false);
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.post(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId + "/deploymentKeys")
            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(deploymentKey))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        var body = tryJSON(res.text);
                        if (res.ok) {
                            if (body) {
                                resolve(body.deploymentKey);
                            } else {
                                reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                            }
                        } else {
                            if (body) {
                                reject(<CodePushError>body);
                            } else {
                                reject(<CodePushError>{ message: res.text, statusCode: res.status });
                            }
                        }
                    }
                });
        });
    }

    public getDeploymentKeys(appId: string, deploymentId: string): Promise<DeploymentKey[]> {
        return Promise<DeploymentKey[]>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.get(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId + "/deploymentKeys")
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.deploymentKeys);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public getDeploymentKey(appId: string, deploymentId: string, deploymentKeyId: string): Promise<DeploymentKey> {
        return Promise<DeploymentKey>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.get(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId + "/deploymentKeys/" + deploymentKeyId)
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.deploymentKey);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public updateDeploymentKey(appId: string, deploymentId: string, deploymentKeyId: string, infoToChange: any): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.put(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId + "/deploymentKeys/" + deploymentKeyId)
            this.attachCredentials(req, requester);

            req.set("Content-Type", "application/json;charset=UTF-8")
                .send(JSON.stringify(infoToChange))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public deleteDeploymentKey(appId: string, deploymentId: string, deploymentKey: DeploymentKey | string): Promise<void> {
        var id: string = (typeof deploymentKey === "string") ? deploymentKey : deploymentKey.id;
        return Promise<void>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.del(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId + "/deploymentKeys/" + id)
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public addPackage(appId: string, deploymentId: string, fileOrPath: File | string, description: string, label: string, appVersion: string, isMandatory: boolean = false): Promise<void> {
        return Promise<void>((resolve, reject, notify) => {
            var packageInfo: PackageToUpload = this.generatePackageInfo(description, label, appVersion, isMandatory);
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.put(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId + "/package");
            this.attachCredentials(req, requester);

            var file: any;
            if (typeof fileOrPath === "string") {
                file = fs.createReadStream(<string>fileOrPath);
            } else {
                file = fileOrPath;
            }

            req.field("package", file)
                .field("packageInfo", JSON.stringify(packageInfo))
                .end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    if (res.ok) {
                        resolve(<void>null);
                    } else {
                        var body = tryJSON(res.text);
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    public getPackage(appId: string, deploymentId: string): Promise<Package> {
        return Promise<Package>((resolve, reject, notify) => {
            var requester = (this._authedAgent ? this._authedAgent : request);
            var req = requester.get(this.serverUrl + "/apps/" + appId + "/deployments/" + deploymentId + "/package");
            this.attachCredentials(req, requester);

            req.end((err: any, res: request.Response) => {
                    if (err) {
                        reject(<CodePushError>{ message: this.getErrorMessage(err, res) });
                        return;
                    }

                    var body = tryJSON(res.text);
                    if (res.ok) {
                        if (body) {
                            resolve(body.package);
                        } else {
                            reject(<CodePushError>{ message: "Could not parse response: " + res.text, statusCode: res.status });
                        }
                    } else {
                        if (body) {
                            reject(<CodePushError>body);
                        } else {
                            reject(<CodePushError>{ message: res.text, statusCode: res.status });
                        }
                    }
                });
        });
    }

    private static getLoginInfo(accessKey: string): ILoginInfo {
        var decoded: string = base64.decode(accessKey);

        return tryJSON(decoded);
    }

    private getErrorMessage(error: Error, response: request.Response): string {
        return response && response.text ? response.text : error.message;
    }

    private generatePackageInfo(description: string, label: string, appVersion: string, isMandatory: boolean): PackageToUpload {
        return {
            description: description,
            label: label,
            appVersion: appVersion,
            isMandatory: isMandatory
        };
    }

    private generateDeploymentKey(name: string, description?: string, isPrimary?: boolean, id?: string): DeploymentKey {
        return <DeploymentKey>{ id: id, name: name, description: description, isPrimary: !!isPrimary };
    }

    private attachCredentials(request: request.Request<any>, requester: request.SuperAgent<any>): void {
        if (this._saveAuthedAgent) {
            if (requester && requester.attachCookies) {
                requester.attachCookies(request);
            }
        } else {
            request.withCredentials();
        }
    }
}

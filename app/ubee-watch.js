// Ubee Watch App SDK
// Author: Alan Badillo Salas
// Email: badillo.soft@hotmail.com
// Github: https://github.com/badillosoft/ubee-watch
// Versión: 1.0 (May 2019)
// License: GPLv3

class UbeeEvent {
    constructor() {
        this.listeners = {};
    }
    
    subscribe(channel, callback, id = null) {
        this.listeners[channel] = this.listeners[channel] || {};
        id = id || UbeeUtil.uuid();
        this.listeners[channel][id] = callback;
        return id;
    }
    
    off(channel, id = null) {
        if (!channel) {
            for (let channel in this.listeners) {
                this.off(channel);
            }
            return;
        }
        this.listeners[channel] = this.listeners[channel] || {};
        if (!id) {
            for (let id in this.listeners[channel]) {
                this.off(channel, id);
            }
            delete this.listeners[channel];
            return;
        }
        delete this.listeners[channel][id];
    }

    async until(channel) {
        await new Promise(resolve => {
            const id = this.subscribe(channel, (...params) => {
                this.off(channel, id);
                resolve(params);
            });
        });
    }

    fire(channel, ...params) {
        for (let [_, callback] of Object.entries(this.listeners[channel] || {})) {
            callback(...params);
        }
    }
}

class UbeeUtil {
    static uuid(length = 8, radix = 32) {
        let token = "";
        while (token.length < length) {
            token += Math.random().toString(radix).slice(2);
        }
        return token.slice(0, length);
    }

    static async wait(predicate, timeout = 100, maxtime = 15000) {
        const start = new Date();
        let successid = null;
        let failid = null;
        return await new Promise((resolve, reject) => {
            failid = setTimeout(() => {
                clearInterval(successid);
                reject(`time exceed: ${new Date() - start}`);
            }, maxtime);
            successid = setInterval(() => {
                if (!predicate()) {
                    return;
                }
                clearTimeout(failid);
                resolve(`time elapsed: ${new Date() - start}`);
            }, timeout);
        });
    }

    static async installScript(url, target = null, timeout = 17) {
        if (!url) {
            console.warn(`Invald script url ${url}`);
            return;
        }
        const id = window.btoa(url);
        window.scripts = window.scripts || {};
        if (window.scripts[id]) {
            await UbeeUtil.wait(() => !!window.scripts[id], timeout);
            return;
        }
        target = target || document.body;
        await new Promise(resolve => {
            const script = document.createElement("script");
            script.src = url;
            script.addEventListener("load", () => {
                window.scripts[id] = script;
                resolve();
            });

            target.appendChild(script);
        });
    }
}

function watch(index, data) {
    window.ubee.fire("@watch:update", index, data);
}

function look(index, callback) {
    window.ubee.fire("@look:update", index);
    window.ubee.subscribe(`@look#${index}`, callback);
}

(() => {
    {
        console.log("Ubee v1.0");
    
        const ubee = window.ubee = new UbeeEvent();
    
        const params = (document.currentScript.src.split("?")[1] || "")
            .split("&").map(s => s.split("="))
            .reduce((params, [key, value]) => {
                params[key] = value;
                return params;
            }, {});
    
        let { appId, watchTime } = Object.assign({
            watchTime: 500,
        }, params);

        if (!appId) {
            console.warn(`Ubee error: Invalid App Id`);
            console.warn(`Ubee help: <script src="ubee-watch.js?appId=XXXX">`);
            return;
        }
    
        localStorage.setItem("ubee-app-id", appId);
    
        const deviceId = localStorage.getItem("ubee-device-id") || UbeeUtil.uuid(256);

        console.warn(`Ubee Device Id: ${deviceId}`);
    
        localStorage.setItem("ubee-device-id", deviceId);
        
        const cdn = "https://cdnjs.cloudflare.com/ajax/libs/socket.io/2.2.0/socket.io.js"
    
        ubee.subscribe("@status:online", () => {
            console.warn("Ubee is online");
            ubee.fire("@watch:resume");
            ubee.fire("@look:resume");
        });
        ubee.subscribe("@status:offline", () => {
            console.warn("Ubee is offline");
            ubee.fire("@watch:pause");
            ubee.fire("@look:pause");
        });

        let watchStarted = false;
        let watchPaused = true;        
        let watchStorage = {};

        ubee.subscribe("@watch:resume", () => {
            watchPaused = false;
            console.warn("Ubee watch is resumed");
            ubee.fire("@watch:update", "token", UbeeUtil.uuid());
        });
        ubee.subscribe("@watch:pause", () => {
            watchPaused = true;
            console.warn("Ubee watch is paused");
        });
        ubee.subscribe("@watch:start", () => {
            watchStarted = true;
            ubee.fire("@watch:next");
        });
        ubee.subscribe("@watch:stop", () => {
            watchStarted = false;
        });
        ubee.subscribe("@watch:update", (index, data) => {
            if (!watchStarted || watchPaused) {
                return;
            }
            watchStorage[index] = watchStorage[index] || {};
            watchStorage[index].index = index;
            watchStorage[index].data = data;
            watchStorage[index].update = new Date();
        });
        ubee.subscribe("@watch:next", async () => {
            if (!watchStarted) {
                console.warn("Ubee watch stopped");
                ubee.fire("@watch:break");
                return;
            }

            if (watchPaused) {
                console.warn("Ubee watch on pause");
                await new Promise(resolve => setTimeout(resolve, watchTime));
                ubee.fire("@watch:next");
                return;
            }

            // console.log("@watch:next", UbeeUtil.uuid(4));
            let promises = [];
            const now = new Date();
            for (let [index, watcher] of Object.entries(watchStorage)) {
                if (now - watcher.update > watchTime) {
                    continue;
                }
                promises.push(new Promise(resolve => {
                    ubee.fire("@watch:sync", index, watcher.data, package => {
                        watcher.status = package.status;
                        resolve(watcher);
                    });
                }));
            }
            await Promise.all(promises);
            await new Promise(resolve => setTimeout(resolve, watchTime));
            ubee.fire("@watch:next");
        });
        ubee.fire("@watch:start");

        (async () => {
            await UbeeUtil.installScript(cdn);
    
            const socket = io("http://192.169.200.243:5000");
    
            socket.on("connect", () => {
                ubee.fire("@status:online");
            });
    
            socket.on("disconnect", () => {
                ubee.fire("@status:offline");
            });
    
            socket.on("error", error => {
                console.warn(error);
                ubee.fire("@status:offline");
                ubee.fire("@status:error", error);
            });
    
            ubee.subscribe("@watch:sync", (index, data, callback) => {
                const package = {
                    appId,
                    deviceId,
                    index,
                    data
                };
    
                socket.emit("watch", package, status => {
                    package.status = status;
                    typeof callback !== "function" || callback(package);
                });
            });

            socket.on(`look`, (index, data) => {
                ubee.fire(`@look#${index}`, data);
            });
        })();
    }
})();
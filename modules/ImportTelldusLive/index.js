/*** ImportTelldusLive module *******************************************

Version: 1.0.0
-----------------------------------------------------------------------------
Author: Ruben Andreassen <rubean85@gmail.com>
Description:
    Imports devices from Telldus Live via Proxy Script
******************************************************************************/

function ImportTelldusLive(id, controller) {
    // Always call superconstructor first
    ImportTelldusLive.super_.call(this, id, controller);

    // Perform internal structures initialization...
}

inherits(ImportTelldusLive, AutomationModule);

_module = ImportTelldusLive;

ImportTelldusLive.prototype.init = function (config) {
    // Always call superclass' init first
    ImportTelldusLive.super_.prototype.init.call(this, config);

    this.urlPrefix = this.config.url + "/index.php";
    this.dT = Math.max(this.config.dT, 500); // 500 ms minimal delay between requests
    this.lastRequest = 0;
    this.timer = null;

    this.requestUpdate();
};

ImportTelldusLive.prototype.stop = function () {
    var self = this;

    if (this.timer) {
        clearTimeout(this.timer);
    }

    this.controller.devices.filter(function (xDev) {
        return (xDev.id.indexOf("TL_" + self.id + "_") !== -1);
    }).map(function (yDev) {
        return yDev.id;
    }).forEach(function (item) {
        self.controller.devices.remove(item);
    });

    ImportTelldusLive.super_.prototype.stop.call(this);
};


// ----------------------------------------------------------------------------
// --- Module methods
// ----------------------------------------------------------------------------

ImportTelldusLive.prototype.requestUpdate = function () {
    var self = this;

    this.lastRequest = Date.now();

    try {
        http.request({
            url: this.urlPrefix+"?URI={%22resource%22:%22devices%22,%22function%22:%22list%22}&params={%22supportedMethods%22:19,%22includeIgnored%22:1}",
            method: "GET",
            async: true,
            success: function (response) {
                self.parseResponse(response);
            },
            error: function (response) {
                console.log("Can not make request: " + response.statusText); // don't add it to notifications, since it will fill all the notifcations on error
            },
            complete: function () {
                var dt = self.lastRequest + self.dT - Date.now();
                if (dt < 0) {
                    dt = 1; // in 1 ms not to make recursion
                }

                if (self.timer) {
                    clearTimeout(self.timer);
                }

                self.timer = setTimeout(function () {
                    self.requestUpdate();
                }, dt);
            }
        });
    } catch (e) {
        self.timer = setTimeout(function () {
            self.requestUpdate();
        }, self.dT);
    }
};

ImportTelldusLive.prototype.parseResponse = function (response) {
    var self = this;

    if (response.status === 200, response.contentType === "application/json") {
        var data = response.data;

        data.device.forEach(function (item) {
            var localId = "TL_" + self.id + "_" + item.id,
                    vDev = self.controller.devices.get(localId);

            var level = "off";
            switch (parseInt(item.state, 10)) {
                case 1: //ON
                    level = "on";
                    break;
                case 2: //OFF
                    level = "off";
                    break;
                case 16: //ON Dim
                    //Konverting from the scale from 0-255 to 0-99
                    level = Math.round((parseInt(item.statevalue, 10) / 255) * 99);
                    break;
            }

            if (vDev) {
                vDev.set("metrics:level", level);
            } else {
                if (self.skipDevice(localId)) {
                    return;
                }
                
                var deviceType = (item.methods === 19) ? "switchMultilevel" : "switchBinary";
                var probeTitle = (item.methods === 19) ? "Multilevel" : "Binary";
                var icon = (item.methods === 19) ? "multilevel" : "switch";

                self.controller.devices.create({
                    deviceId: localId,
                    defaults: {
                        deviceType: deviceType,
                        metrics: {
                            probeTitle: probeTitle,
                            level: level,
                            title: "TL " + item.name,
                            icon: icon
                        }
                    },
                    overlay: {},
                    handler: function (command, args) {
                        self.handleCommand(this, command, args);
                    },
                    moduleId: this.id
                });

                self.config.renderDevices.push({deviceId: localId, deviceType: deviceType});
                self.saveConfig();
            }
        });

        if (data.structureChanged) {
            var removeList = this.controller.devices.filter(function (xDev) {
                var found = false;

                if (xDev.id.indexOf("TL_" + self.id + "_") === -1) {
                    return false; // not to remove devices created by other modules
                }

                data.devices.forEach(function (item) {
                    if (("TL_" + self.id + "_" + item.id) === xDev.id) {
                        found |= true;
                        return false; // break
                    }
                });
                return !found;
            }).map(function (yDev) {
                return yDev.id;
            });

            removeList.forEach(function (item) {
                self.controller.devices.remove(item);
            });
        }
    }
};

ImportTelldusLive.prototype.handleCommand = function (vDev, command, args) {
    var self = this;

    var remoteId = vDev.id.slice(("TL_" + this.id + "_").length);
    
    var level = command;
    var method = 0;
    var tlLevel = 0;
    switch (command) {
        case "on":
            method = 1;
            break;
        case "off":
            method = 2;
            break;
        case "exact":
            method = 16; //Dim
            level = args.level;
            tlLevel = Math.round((level/99)*255);
            break;
        default:
            return;
    }

    http.request({
        url: this.urlPrefix+"?URI={%22resource%22:%22device%22,%22function%22:%22command%22}&params={%22id%22:" + remoteId + ",%22method%22:"+method+",%22value%22:" + tlLevel + "}",
        method: "GET",
        async: true,
        success: function (response) {
            if (response.status === 200, response.contentType === "application/json") {
                var data = response.data;
                if (data.status === "success") {
                    vDev.set("metrics:level", level);
                }
            }
        },
        error: function (response) {
            console.log("Can not make request: " + response.statusText); // don't add it to notifications, since it will fill all the notifcations on error
        },
        complete: function () {
        }
    });
};

ImportTelldusLive.prototype.skipDevice = function (id) {
    var skip = false;

    this.config.skipDevices.forEach(function (skipItem) {
        if (skipItem === id) {
            skip |= true;
            return false; // break
        }
    });

    return skip;
};
 
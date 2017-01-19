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
    this.sT = Math.max(this.config.sT, 30000); // 30000 ms minimal delay between requests for sensors
    this.urlEmonCMSPrefix = this.config.urlEmonCMS;
    this.apiKeyEmonCMS = this.config.apiKeyEmonCMS;
    this.lastRequestD = 0;
    this.lastRequestS = 0;
    this.timerD = null; //Device Timer
    this.timerS = null; //Sensor Timer

    this.requestDeviceUpdate();
    this.requestSensorUpdate();
};

ImportTelldusLive.prototype.stop = function () {
    var self = this;

    if (this.timerD) {
        clearTimeout(this.timerD);
    }
    if (this.timerS) {
        clearTimeout(this.timerS);
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

ImportTelldusLive.prototype.requestDeviceUpdate = function () {
    var self = this;

    this.lastRequestD = Date.now();

    try {
        http.request({
            url: this.urlPrefix + "?URI={%22resource%22:%22devices%22,%22function%22:%22list%22}&params={%22supportedMethods%22:19,%22includeIgnored%22:1}",
            method: "GET",
            async: true,
            success: function (response) {
                self.parseDeviceResponse(response);
            },
            error: function (response) {
                console.log("Can not make request: " + response.statusText); // don't add it to notifications, since it will fill all the notifcations on error
            },
            complete: function () {
                var dt = self.lastRequestD + self.dT - Date.now();
                if (dt < 0) {
                    dt = 1; // in 1 ms not to make recursion
                }

                if (self.timerD) {
                    clearTimeout(self.timerD);
                }

                self.timerD = setTimeout(function () {
                    self.requestDeviceUpdate();
                }, dt);
            }
        });
    } catch (e) {
        self.timerD = setTimeout(function () {
            self.requestDeviceUpdate();
        }, self.dT);
    }
};

ImportTelldusLive.prototype.parseDeviceResponse = function (response) {
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
                    level = (item.statevalue === null) ? 0 : Math.round((parseInt(item.statevalue, 10) / 255) * 99);
                    if (isNaN(level)) {
                        level = 0;
                    }
                    break;
            }

            var deviceType = (item.methods === 19) ? "switchMultilevel" : "switchBinary";
            var probeTitle = (item.methods === 19) ? "Multilevel" : "Binary";
            var icon = (item.methods === 19) ? "multilevel" : "switch";
                
            if (vDev) {
                vDev.set("metrics:title", "TL " + item.name); //Update title
                //TODO: Device type dont change when altered in Telldus
//                vDev.set("metrics:probeTitle", probeTitle); //Update 
//                vDev.set("metrics:icon", icon); //Update 
//                vDev.set("deviceType", deviceType); //Update 
                
                if (vDev.get("metrics:level") !== level) { //Only change if the level if different (or triggers will go haywire)
                    vDev.set("metrics:level", level);
                }
            } else if (!self.skipDevice(localId)) {
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
                        self.handleDeviceCommand(this, command, args);
                    },
                    moduleId: this.id
                });

                self.renderDevice({deviceId: localId, deviceType: "sensorMultilevel"});
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

ImportTelldusLive.prototype.handleDeviceCommand = function (vDev, command, args) {
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
            tlLevel = Math.round((level / 99) * 255);
            break;
        default:
            return;
    }

    http.request({
        url: this.urlPrefix + "?URI={%22resource%22:%22device%22,%22function%22:%22command%22}&params={%22id%22:" + remoteId + ",%22method%22:" + method + ",%22value%22:" + tlLevel + "}",
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

ImportTelldusLive.prototype.logSensorValue = function (vDev) {
    var self = this;
    try {
        var url = this.urlEmonCMSPrefix+"/input/post.json?time=" + vDev.get("updateTime") + "&node=" + vDev.id + "&json={%22" + vDev.get("metrics:icon") + "%22:%22" + vDev.get("metrics:level") + "%22}&apikey="+this.apiKeyEmonCMS;
        console.log("Logging sensor value " + url);
        http.request({
            url: url,
            method: "GET",
            async: true,
            success: function (response) {
                console.log("response status "+response.data.success+" message: "+response.data.message);
            },
            error: function (response) {
                console.log("Can not make request: " + response.statusText); // don't add it to notifications, since it will fill all the notifcations on error
            },
            complete: function () {
            }
        });
    } catch (e) {
        //Probably error in one of vDev.get
    }
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

ImportTelldusLive.prototype.renderDevice = function (obj) {
    var skip = false;

    this.config.renderDevices.forEach(function (deviceObj) {
        if (deviceObj.deviceId === obj.deviceId) {
            skip |= true;
            return false; // break
        }
    });

    if (!skip) {
        this.config.renderDevices.push(obj);
        this.saveConfig();
    }
};

ImportTelldusLive.prototype.requestSensorUpdate = function () {
    var self = this;

    this.lastRequestS = Date.now();

    try {
        http.request({
            url: this.urlPrefix + "?URI={%22resource%22:%22sensors%22,%22function%22:%22list%22}&params={%22includeValues%22:1,%22includeIgnored%22:1,%22includeScale%22:1}",
            method: "GET",
            async: true,
            success: function (response) {
                self.parseSensorResponse(response);
            },
            error: function (response) {
                console.log("Can not make request: " + response.statusText); // don't add it to notifications, since it will fill all the notifcations on error
            },
            complete: function () {
                var dt = self.lastRequestS + self.sT - Date.now();
                if (dt < 0) {
                    dt = 1; // in 1 ms not to make recursion
                }

                if (self.timerS) {
                    clearTimeout(self.timerS);
                }

                self.timerS = setTimeout(function () {
                    self.requestSensorUpdate();
                }, dt);
            }
        });
    } catch (e) {
        self.timerS = setTimeout(function () {
            self.requestSensorUpdate();
        }, self.sT);
    }
};


ImportTelldusLive.prototype.parseSensorResponse = function (response) {
    var self = this;

    if (response.status === 200, response.contentType === "application/json") {
        var data = response.data;

        data.sensor.forEach(function (item) {
            var subId = 0;
            item.data.forEach(function (sensorData) {
                var localId = "TL_" + self.id + "_" + item.id + "" + subId,
                        vDev = self.controller.devices.get(localId);

                if (vDev) {
                    vDev.set("metrics:title", "TL " + item.name + " " + sensorData.name); //Update title
                    vDev.set("updateTime", sensorData.lastUpdated);
                    if (vDev.get("metrics:level") !== sensorData.value) { //Only change if the level if different (or triggers will go haywire)
                        vDev.set("metrics:level", sensorData.value);
                    }
                } else if (!self.skipDevice(localId)) {
                    var icon = (sensorData.name === "temp") ? "temperature" : "humidity";
                    var scaleTitle = (sensorData.name === "temp") ? "°C" : "%";

                    self.controller.devices.create({
                        deviceId: localId,
                        defaults: {
                            deviceType: "sensorMultilevel",
                            metrics: {
                                probeTitle: item.model,
                                level: sensorData.value,
                                title: "TL " + item.name + " " + sensorData.name,
                                icon: icon,
                                scaleTitle: scaleTitle
                            }
                        },
                        overlay: {},
                        handler: {},
                        moduleId: this.id,
                        probeType: icon,
                        updateTime: item.lastUpdated
                    });

                    self.renderDevice({deviceId: localId, deviceType: "sensorMultilevel"});
                }
                //Log values to EmonCMS if URL and API Key is provided
                if (this.urlEmonCMSPrefix.length > 0 && this.apiKeyEmonCMS.length > 0) {
                    self.logSensorValue(vDev);
                }
                subId++;
            });
        });

        if (data.structureChanged) {
            var removeList = this.controller.devices.filter(function (xDev) {
                var found = false;

                if (xDev.id.indexOf("TL_" + self.id + "_") === -1) {
                    return false; // not to remove devices created by other modules
                }

                data.sensor.forEach(function (item) {
                    var subId = 0;
                    item.data.forEach(function (sensorData) {
                        if (("TL_" + self.id + "_" + item.id + "" + subId) === xDev.id) {
                            found |= true;
                            return false; // break
                        }
                        subId++;
                    });
                    return !found;
                });
                return found;
            }).map(function (yDev) {
                return yDev.id;
            });

            removeList.forEach(function (item) {
                self.controller.devices.remove(item);
            });
        }
    }
};
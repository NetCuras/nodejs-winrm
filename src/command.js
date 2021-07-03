const js2xmlparser = require('js2xmlparser');
let winrm_soap_req = require('./base-request.js');
let winrm_http_req = require('./http.js');
let util = require('./util.js');

function constructRunCommandRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'action': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command',
        'shellId': _params.shellId,
        'operationTimeout': _params.operationTimeout
    });

    res['s:Header']['wsman:OptionSet'] = [];
    res['s:Header']['wsman:OptionSet'].push({
        'wsman:Option': [{
                '@': {
                    'Name': 'WINRS_CONSOLEMODE_STDIN'
                },
                '#': 'TRUE'
            },
            {
                '@': {
                    'Name': 'WINRS_SKIP_CMD_SHELL'
                },
                '#': 'FALSE'
            }
        ]
    });
    res['s:Body'] = {
        'rsp:CommandLine': {
            'rsp:Command': _params.command
        }
    };
    return js2xmlparser.parse('s:Envelope', res);
}

function constructReceiveRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'action': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive',
        'shellId': _params.shellId,
        'operationTimeout': _params.operationTimeout
    });

    res['s:Body'] = {
        'rsp:Receive': {
            'rsp:DesiredStream': {
                '@': {
                    'CommandId': _params.commandId
                },
                '#': 'stdout stderr'
            }
        }
    };
    return js2xmlparser.parse('s:Envelope', res);
}

function constructSignalRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'action': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Signal',
        'shellId': _params.shellId,
        'operationTimeout': _params.operationTimeout
    });

    res['s:Body'] = {
        'rsp:Signal': [{
            '@': {
                'xmlns:rsp': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell',
                'CommandId': _params.commandId
            },
            'rsp:Code': `http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/${_params.signal || 'ctrl_c'}`
        }]
    };
    return js2xmlparser.parse('s:Envelope', res);
}

module.exports.doExecuteCommand = async function (_params) {
    var req = constructRunCommandRequest(_params);

    var auth = _params.auth;
    if (_params.authOnce) {
        auth = typeof _params.authOnce === 'string' ? _params.authOnce : _params.auth;
        _params.auth = undefined;
        _params.authOnce = undefined;
    }
    var result = await winrm_http_req.sendHttp(req, _params.host, _params.port, _params.path, auth, _params.agent, _params.requestOptions);

    if (result['s:Envelope']['s:Body'][0]['s:Fault']) {
        return new Error(util.faultFormatter(result['s:Envelope']['s:Body'][0]['s:Fault']));
    } else {
        var commandId = result['s:Envelope']['s:Body'][0]['rsp:CommandResponse'][0]['rsp:CommandId'][0];
        return commandId;
    }
};

function generatePowershellCommand(_params) {
    var args = [];
    args.unshift(
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-NoLogo',
        '-ExecutionPolicy', 'Bypass',
        '-InputFormat', 'Text',
        '-Command', '"& {',
        _params.command,
        '}"'
    );
    return args.join(' ');
}

module.exports.doExecutePowershell = async function (_params) {
    _params['command'] = generatePowershellCommand(_params);
    return this.doExecuteCommand(_params);
};

module.exports.doReceive = async function (_params) {
    var req = constructReceiveRequest(_params);

    var auth = _params.auth;
    if (_params.authOnce) {
        auth = typeof _params.authOnce === 'string' ? _params.authOnce : _params.auth;
        _params.auth = undefined;
        _params.authOnce = undefined;
    }
    var result = await winrm_http_req.sendHttp(req, _params.host, _params.port, _params.path, auth, _params.agent, _params.requestOptions);

    if (result['s:Envelope']['s:Body'][0]['s:Fault']) {
        return new Error(util.faultFormatter(result['s:Envelope']['s:Body'][0]['s:Fault']));
    } else {
        let response = {
            commandState: undefined,
            exitCode: undefined,
            streams: []
        };
        if (result['s:Envelope']['s:Body'][0]['rsp:ReceiveResponse'][0]['rsp:Stream']) {
            for (let stream of result['s:Envelope']['s:Body'][0]['rsp:ReceiveResponse'][0]['rsp:Stream']) {
                let streamOutput = {};
                streamOutput.name = stream['$'].Name;
                if (stream['$'].hasOwnProperty('End')) {
                    streamOutput.end = true;
                } else if (stream['_']) {
                    streamOutput.data = Buffer.from(stream['_'], 'base64').toString('ascii');
                }
                response.streams.push(streamOutput);
            }
        }

        if (result['s:Envelope']['s:Body'][0]['rsp:ReceiveResponse'][0]['rsp:CommandState']) {
            let commandStateResponse = result['s:Envelope']['s:Body'][0]['rsp:ReceiveResponse'][0]['rsp:CommandState'][0];
            response.commandState = (commandStateResponse['$'].State || '').match(/\/([a-zA-Z0-9]+)$/)[1];
            response.exitCode = commandStateResponse['rsp:ExitCode'] && commandStateResponse['rsp:ExitCode'][0];
        }

        // NOTE: for use with doReceiveOutput (set here for consistency), use returned response.commandState/response.exitCode when available
        _params.commandState = response.commandState;
        _params.exitCode = response.exitCode;

        return response;
    }
};

module.exports.doReceiveOutput = async function (_params) {
    let response = await module.exports.doReceive(_params);
    if (response instanceof Error) {
        return response;
    }
    let successOutput = '';
    let failedOutput = '';
    for (let stream of response.streams) {
        if (stream.name === 'stdout' && !stream.end) {
            successOutput += stream.data;
        }
        if (stream.name == 'stderr' && !stream.end) {
            failedOutput += stream.data;
        }
    }
    if (successOutput) {
        return successOutput.trim();
    }
    return failedOutput.trim();
};

module.exports.doSignal = async function (_params) {
    var req = constructSignalRequest(_params);

    var auth = _params.auth;
    if (_params.authOnce) {
        auth = typeof _params.authOnce === 'string' ? _params.authOnce : _params.auth;
        _params.auth = undefined;
        _params.authOnce = undefined;
    }

    console.log(req);
    var result = await winrm_http_req.sendHttp(req, _params.host, _params.port, _params.path, auth, _params.agent, _params.requestOptions);

    if (result['s:Envelope']['s:Body'][0]['s:Fault']) {
        return new Error(util.faultFormatter(result['s:Envelope']['s:Body'][0]['s:Fault']));
    } else {
        return result['s:Envelope']['s:Body'][0]['rsp:SignalResponse'][0];
    }
};

module.exports.doSignalInterrupt = async function (_params) {
    return module.exports.doSignal(Object.assign({}, _params, { signal: 'ctrl_c' }));
};

module.exports.doSignalTerminate = async function (_params) {
    return module.exports.doSignal(Object.assign({}, _params, { signal: 'terminate' }));
};

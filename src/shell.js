const js2xmlparser = require('js2xmlparser');
let winrm_soap_req = require('./base-request.js');
let winrm_http_req = require('./http.js');
let util = require('./util.js');

function constructCreateShellRequest() {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'action': 'http://schemas.xmlsoap.org/ws/2004/09/transfer/Create'
    });

    res['s:Header']['wsman:OptionSet'] = [];
    res['s:Header']['wsman:OptionSet'].push({
        'wsman:Option': [{
                '@': {
                    'Name': 'WINRS_NOPROFILE'
                },
                '#': 'FALSE'
            },
            {
                '@': {
                    'Name': 'WINRS_CODEPAGE'
                },
                '#': '437'
            }
        ]
    });
    res['s:Body'] = {
        'rsp:Shell': [{
            'rsp:InputStreams': 'stdin',
            'rsp:OutputStreams': 'stderr stdout'
        }]
    };
    return js2xmlparser.parse('s:Envelope', res);

}

function constructDeleteShellRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'resource_uri': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd',
        'action': 'http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete',
        'shellId': _params.shellId
    });

    res['s:Body'] = {};
    return js2xmlparser.parse('s:Envelope', res);

}

module.exports.doCreateShell = async function (_params) {
    var req = constructCreateShellRequest();

    var auth = _params.auth;
    if (_params.authOnce) {
        auth = typeof _params.authOnce === 'string' ? _params.authOnce : _params.auth;
        _params.auth = undefined;
        _params.authOnce = undefined;
    }
    var result = await winrm_http_req.sendHttp(req, _params.host, _params.port, _params.path, auth, _params.agent);

    if (result['s:Envelope']['s:Body'][0]['s:Fault']) {
        return new Error(util.faultFormatter(result['s:Envelope']['s:Body'][0]['s:Fault']));
    } else {
        var shellId = result['s:Envelope']['s:Body'][0]['rsp:Shell'][0]['rsp:ShellId'][0];
        return shellId;
    }
};

module.exports.doDeleteShell = async function (_params) {
    var req = constructDeleteShellRequest(_params);

    var auth = _params.auth;
    if (_params.authOnce) {
        auth = typeof _params.authOnce === 'string' ? _params.authOnce : _params.auth;
        _params.auth = undefined;
        _params.authOnce = undefined;
    }
    var result = await winrm_http_req.sendHttp(req, _params.host, _params.port, _params.path, auth, _params.agent);

    if (result['s:Envelope']['s:Body'][0]['s:Fault']) {
        return new Error(util.faultFormatter(result['s:Envelope']['s:Body'][0]['s:Fault']));
    } else {
        //var output = result['s:Envelope']['s:Body'][0]['rsp:ReceiveResponse'][0]['rsp:Stream'];
        return 'success';
    }
};
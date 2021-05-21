const js2xmlparser = require('js2xmlparser');
let winrm_soap_req = require('./base-request.js');
let winrm_http_req = require('./http.js');
let util = require('./util.js');

function constructInvokeActionRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'resource_uri': _params.resourceUri,
        'action': _params.actionUri || (util.removeQueryString(_params.resourceUri) + '/' + _params.action),
        'selectorSet': _params.selectorSet
    });

    res['s:Body'] = {
        [`p:${_params.action}_INPUT`]: [{
            '@': {
                'xmlns:p': util.removeQueryString(_params.resourceUri)
            },
            '#': _params.actionInput
        }]
    };

    return js2xmlparser.parse('s:Envelope', res);
}

module.exports.doInvokeAction = async function (_params) {
    var req = constructInvokeActionRequest(_params);

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
        return result['s:Envelope']['s:Body'][0][`p:${_params.action}_OUTPUT`][0];
    }
};

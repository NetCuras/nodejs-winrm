const js2xmlparser = require('js2xmlparser');
let winrm_soap_req = require('./base-request.js');
let winrm_http_req = require('./http.js');
let util = require('./util.js');

function constructBeginEnumerationRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'resource_uri': _params.resourceUri || 'http://schemas.dmtf.org/wbem/wscim/1/*',
        'action': 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/Enumerate',
        'selectorSet': _params.selectorSet,
        'operationTimeout': _params.operationTimeout
    });

    res['s:Body'] = {
        'wsen:Enumerate': [{
            'wsen:NewContext': {},
            'wsman:OptimizeEnumeration': [{}],
            'wsen:MaxTime': _params.maxTime || 'PT60S',
            'wsman:MaxElements': _params.maxElements || 20
        }]
    };

    if (_params.filter) {
        res['s:Body']['wsen:Enumerate'][0]['wsman:Filter'] = [{
            '@': {
              'Dialect': _params.filterDialect || 'http://www.w3.org/TR/1999/REC-xpath-19991116'
            },
            '#': _params.filter
        }];
    }

    return js2xmlparser.parse('s:Envelope', res);
}

function constructPullEnumerationRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'resource_uri': _params.resourceUri || 'http://schemas.dmtf.org/wbem/wscim/1/*',
        'action': 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull',
        'operationTimeout': _params.operationTimeout
    });

    res['s:Body'] = {
        'wsen:Pull': [{
            'wsen:EnumerationContext': _params.enumerationId,
            'wsen:MaxTime': _params.maxTime || 'PT10S',
            'wsen:MaxElements': _params.maxElements || 20
        }]
    };

    return js2xmlparser.parse('s:Envelope', res);
}

function constructReleaseEnumerationRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'resource_uri': _params.resourceUri || 'http://schemas.dmtf.org/wbem/wscim/1/*',
        'action': 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/Release',
        'operationTimeout': _params.operationTimeout
    });

    res['s:Body'] = {
        'wsen:Release': [{
            'wsen:EnumerationContext': _params.enumerationId
        }]
    };

    return js2xmlparser.parse('s:Envelope', res);
}

function getObjects(items) {
    // NOTE only suitable for objects structures like WMI, need additional handlers for other data types
    if (!items) {
        return [];
    }
    let itemCollection = Object.values(items[0])[0];
    let itemObjects = [];
    for (let item of itemCollection) {
        let itemObject = {};
        for (let prop in item) {
            if (prop === '$') { continue; }
            let keyName = prop.replace(/^p:/, '');
            let value = item[prop][0];
            if (value && value['Datetime']) {
                value = value['Datetime'][0];
            }
            if (value && value['$'] && value['$']['xsi:nil'] === 'true') {
                value = null;
            }
            if (typeof value === 'string' && !isNaN(value)) {
                value = Number(value);
            }
            itemObject[keyName] = value;
        }
        itemObjects.push(itemObject);
    }
    return itemObjects;
}

module.exports.doBeginEnumeration = async function (_params) {
    var req = constructBeginEnumerationRequest(_params);

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
        var enumerationId = result['s:Envelope']['s:Body'][0]['n:EnumerateResponse'][0]['n:EnumerationContext'][0];
        _params.enumerationId = enumerationId;

        if (result['s:Envelope']['s:Body'][0]['n:EnumerateResponse'][0]['n:EndOfSequence']) {
            _params.endOfSequence = true;
        } else {
            _params.endOfSequence = false;
        }
        let items = result['s:Envelope']['s:Body'][0]['n:EnumerateResponse'][0]['w:Items'];
        return getObjects(items);
    }
};

module.exports.doPullEnumeration = async function (_params) {
    var req = constructPullEnumerationRequest(_params);

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
        if (result['s:Envelope']['s:Body'][0]['n:PullResponse'][0]['n:EndOfSequence']) {
            _params.endOfSequence = true;
        } else {
            _params.endOfSequence = false;
            _params.enumerationId = result['s:Envelope']['s:Body'][0]['n:PullResponse'][0]['n:EnumerationContext'][0];
        }
        let items = result['s:Envelope']['s:Body'][0]['n:PullResponse'][0]['n:Items'];
        return getObjects(items);
    }
};

module.exports.doReleaseEnumeration = async function (_params) {
    var req = constructReleaseEnumerationRequest(_params);

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
        return 'success';
    }
};

module.exports.doEnumerateAll = async function (_params) {
    _params.endOfSequence = false;
    var items = [];

    var result = await module.exports.doBeginEnumeration(_params);
    if (Array.isArray(result)) {
        items.push(...result);
    } else {
        return result;
    }

    while (!_params.endOfSequence && _params.enumerationId) {
        var pullResult = await module.exports.doPullEnumeration(_params);
        if (Array.isArray(pullResult)) {
            items.push(...pullResult);
        } else {
            // TODO attempt to release enumeration on error?
            // TODO should we return partial successful items?
            return pullResult;
        }
    }
    return items;
};

const js2xmlparser = require('js2xmlparser');
let winrm_soap_req = require('./base-request.js');
let winrm_http_req = require('./http.js');
let util = require('./util.js');

function constructBeginEnumerationRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'resource_uri': _params.resourceUri || 'http://schemas.dmtf.org/wbem/wscim/1/*',
        'action': 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/Enumerate',
        'selectorSet': _params.selectorSet,
        'operationTimeout': _params.operationTimeout,
        'maxEnvelopeSize': _params.maxEnvelopeSize
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
        'operationTimeout': _params.operationTimeout,
        'maxEnvelopeSize': _params.maxEnvelopeSize
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
        'operationTimeout': _params.operationTimeout,
        'maxEnvelopeSize': _params.maxEnvelopeSize
    });

    res['s:Body'] = {
        'wsen:Release': [{
            'wsen:EnumerationContext': _params.enumerationId
        }]
    };

    return js2xmlparser.parse('s:Envelope', res);
}

function unwrapPropertyValue(value, keepString) {
    if (value && value['Datetime']) {
        value = value['Datetime'][0];
    }
    if (value && value['$'] && value['$']['xsi:nil'] === 'true') {
        value = null;
    }
    // keepString skips the numeric coercion for values that are strings by
    // definition, where coercion mangles hex ("0xC000006D" -> 3221225581) and
    // leading-zero values.
    if (!keepString && typeof value === 'string' && !isNaN(value)) {
        value = Number(value);
    }
    return value;
}

function getObjects(items, arrayProperties) {
    // NOTE only suitable for objects structures like WMI, need additional handlers for other data types
    if (!items) {
        return [];
    }
    let arrayProps = new Set(arrayProperties || []);
    let itemCollection = Object.values(items[0])[0];
    let itemObjects = [];
    for (let item of itemCollection) {
        let itemObject = {};
        for (let prop in item) {
            if (prop === '$') { continue; }
            let keyName = prop.replace(/^p:/, '');
            let values = item[prop];
            let value;
            if (arrayProps.has(keyName)) {
                // Caller-declared array property (e.g. Win32_NTLogEvent
                // InsertionStrings): ALWAYS an array of raw strings, regardless
                // of element count — the XML alone cannot distinguish a
                // one-element array from a scalar, and string values must not
                // be numerically coerced (hex/leading zeros).
                value = values.map(v => unwrapPropertyValue(v, true));
            } else if (values.length > 1) {
                // Repeated XML elements are how WS-Man encodes multi-valued WMI
                // properties — keep all values instead of only the first.
                value = values.map(v => unwrapPropertyValue(v));
            } else {
                value = unwrapPropertyValue(values[0]);
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
        return getObjects(items, _params.arrayProperties);
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
        return getObjects(items, _params.arrayProperties);
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

// A WS-Man enumeration lives on the SERVER until it is explicitly released or
// expires, and every open context counts against the WinRM service's
// concurrent-operation quota. Skipping the release on a failed pull strands one
// context per failed read on the monitored host, which degrades that machine's
// WinRM service rather than anything visible on this side.
//
// Best effort by design: the release is bounded so a dead or wedged socket
// cannot hang the caller — an unreleased context does expire server-side on its
// own — and any failure is swallowed so it can never mask the error that caused
// the exit in the first place.
const RELEASE_BUDGET_MS = 10 * 1000;

async function releaseEnumerationQuietly(_params) {
    // After EndOfSequence the server has already closed the enumeration, and a
    // failed Enumerate never established one.
    if (!_params.enumerationId || _params.endOfSequence) {
        return;
    }
    // _params belongs to the caller and is reused across requests, so the short
    // release budget must not outlive the release itself.
    var callerMaxTime = _params.maxTime;
    var callerOperationTimeout = _params.operationTimeout;
    var callerRequestOptions = _params.requestOptions;
    _params.maxTime = `PT${RELEASE_BUDGET_MS / 1000}S`;
    _params.operationTimeout = `PT${RELEASE_BUDGET_MS / 1000}S`;
    _params.requestOptions = Object.assign({}, callerRequestOptions, { timeout: RELEASE_BUDGET_MS });
    try {
        await module.exports.doReleaseEnumeration(_params);
    } catch {
        // Deliberately ignored — see above.
    } finally {
        _params.maxTime = callerMaxTime;
        _params.operationTimeout = callerOperationTimeout;
        _params.requestOptions = callerRequestOptions;
    }
}

module.exports.doEnumerateAll = async function (_params) {
    _params.endOfSequence = false;
    var items = [];

    var result = await module.exports.doBeginEnumeration(_params);
    if (Array.isArray(result)) {
        items.push(...result);
    } else {
        // Nothing to release: a faulted Enumerate never established a context.
        return result;
    }

    try {
        while (!_params.endOfSequence && _params.enumerationId) {
            var pullResult = await module.exports.doPullEnumeration(_params);
            if (Array.isArray(pullResult)) {
                items.push(...pullResult);
            } else {
                // TODO should we return partial successful items? Callers treat
                // a non-array as failure, so that would change the contract.
                await releaseEnumerationQuietly(_params);
                return pullResult;
            }
        }
    } catch (err) {
        // doPullEnumeration REJECTS rather than returning an Error for the
        // common failures — socket hang-ups, read timeouts, and any non-2xx
        // that is not a 500 SOAP fault (see sendHttp) — so the release has to
        // cover the throw path too. Rethrown unchanged: callers rely on those
        // rejections propagating.
        await releaseEnumerationQuietly(_params);
        throw err;
    }
    return items;
};

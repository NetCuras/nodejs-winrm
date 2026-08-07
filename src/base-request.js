const { v5: uuidv5 } = require('uuid');

// WS-Man applies MaxEnvelopeSize to the marshalled SOAP XML (before any HTTP
// transport compression), so it caps how many records a single Pull can return.
const DEFAULT_MAX_ENVELOPE_SIZE = 153600;

function getMaxEnvelopeSize(_value) {
    // Fall back to the default rather than emitting an invalid envelope.
    var size = typeof _value === 'string' ? Number(_value) : _value;
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
        return DEFAULT_MAX_ENVELOPE_SIZE;
    }
    return size;
}

module.exports.getSoapHeaderRequest = function (_params) {
    if (!_params['message_id']) _params['message_id'] = uuidv5.URL;

    var header = {
        '@': {
            'xmlns:s': 'http://www.w3.org/2003/05/soap-envelope',
            'xmlns:wsa': 'http://schemas.xmlsoap.org/ws/2004/08/addressing',
            'xmlns:wsen': 'http://schemas.xmlsoap.org/ws/2004/09/enumeration',
            'xmlns:wsman': 'http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd',

            'xmlns:p': 'http://schemas.microsoft.com/wbem/wsman/1/wsman.xsd',
            'xmlns:rsp': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell'
        },
        's:Header': {
            'wsa:To': 'http://windows-host:5985/wsman',

            'wsman:ResourceURI': {
                '@': {
                    'mustUnderstand': 'true'
                },
                '#': _params['resource_uri'] || 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd'
            },
            'wsa:ReplyTo': {
                'wsa:Address': {
                    '@': {
                        'mustUnderstand': 'true'
                    },
                    '#': 'http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous'
                }
            },
            'wsman:MaxEnvelopeSize': {
                '@': {
                    'mustUnderstand': 'true'
                },
                '#': String(getMaxEnvelopeSize(_params['maxEnvelopeSize']))
            },
            'wsa:MessageID': 'uuid:' + _params['message_id'],
            'wsman:Locale': {
                '@': {
                    'mustUnderstand': 'false',
                    'xml:lang': 'en-US'
                }
            },
            'wsman:OperationTimeout': _params['operationTimeout'] || 'PT60S',
            'wsa:Action': {
                '@': {
                    'mustUnderstand': 'true'
                },
                '#': _params['action']
            }
        },
    };
    if (_params['shellId']) {
        header['s:Header']['wsman:SelectorSet'] = [];
        header['s:Header']['wsman:SelectorSet'].push({
            'wsman:Selector': [{
                '@': {
                    'Name': 'ShellId'
                },
                '#': _params['shellId']
            }]
        });
    }
    if (_params['selectorSet']) {
        header['s:Header']['wsman:SelectorSet'] = [];
        for (const [key, value] of Object.entries(_params['selectorSet'])) {
            header['s:Header']['wsman:SelectorSet'].push({
                'wsman:Selector': [{
                    '@': {
                        'Name': key
                    },
                    '#': value
                }]
            });
        }
    }

    return header;
};

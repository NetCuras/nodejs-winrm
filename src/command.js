const js2xmlparser = require('js2xmlparser');
const { StringDecoder } = require('string_decoder');
let winrm_soap_req = require('./base-request.js');
let winrm_http_req = require('./http.js');
let util = require('./util.js');

// The previous decode was toString('ascii'), which does not validate — it masks
// the high bit of every byte above 0x7F, so 0xE9 arrived as 'i'. That invents a
// character the device never sent, and it is why callers gzip+base64 their
// payload on the Windows side: to keep the bytes inside the range this could not
// damage.
//
// The default is 'latin1' rather than 'utf8' deliberately.
//
// doCreateShell pins WINRS_CODEPAGE to 437, so the byte stream is CP437, not
// UTF-8, and decoding it as UTF-8 does not recover the character — it destroys it
// differently. A CP437 0x82 ('é') becomes U+FFFD, and 0xE9 ('Θ') is a valid UTF-8
// LEAD byte, so a decoder holds it waiting for continuation bytes that never
// come. 'latin1' keeps every structural property the old 'ascii' had — one byte
// in, exactly one character out, no buffering, no replacement characters — and
// unlike 'ascii' it round-trips any byte sequence exactly, so a caller can
// recover the original bytes and apply the right codepage itself.
//
// 'utf8' is available for remotes that genuinely emit it (codepage 65001, or
// PowerShell configured for UTF-8). That path needs the StringDecoder below: a
// multi-byte character can straddle the boundary between two chunks — both
// between chunks in one Receive response and across successive Receive calls —
// and decoding each chunk alone yields two broken halves. Measured against a
// buffer split mid-character: whole-buffer utf8 gave the correct text, per-chunk
// utf8 gave the leading characters plus two U+FFFD replacements, per-chunk ascii
// gave garbage.
//
// One decoder per stream, because stdout and stderr are separate byte sequences
// whose chunks interleave and would otherwise be fed into each other's
// half-finished characters.
//
// Pure-ASCII output — which is most command output, and all of any base64 payload
// — decodes identically under 'ascii', 'latin1' and 'utf8', so nothing that
// worked before changes. 'ascii' remains selectable for byte-identical legacy
// behaviour.
const DEFAULT_STREAM_ENCODING = 'latin1';

function getStreamDecoder(_params, _name) {
    var encoding = Buffer.isEncoding(_params.encoding) ? _params.encoding : DEFAULT_STREAM_ENCODING;
    if (!_params.streamDecoders) {
        _params.streamDecoders = {};
    }
    var held = _params.streamDecoders[_name];
    // The requested encoding is tracked alongside the decoder rather than read
    // back off it: StringDecoder normalises its own encoding ('UTF-8' becomes
    // 'utf8'), so comparing against it would rebuild the decoder on every chunk
    // for those spellings and throw away exactly the buffered bytes it exists to
    // hold.
    if (!held || held.encoding !== encoding) {
        held = { encoding: encoding, decoder: new StringDecoder(encoding) };
        _params.streamDecoders[_name] = held;
    }
    return held.decoder;
}

function flushStreamDecoder(_params, _name) {
    var held = _params.streamDecoders && _params.streamDecoders[_name];
    if (!held) {
        return '';
    }
    delete _params.streamDecoders[_name];
    return held.decoder.end();
}

function constructRunCommandRequest(_params) {
    var res = winrm_soap_req.getSoapHeaderRequest({
        'action': 'http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command',
        'shellId': _params.shellId,
        'operationTimeout': _params.operationTimeout,
        'maxEnvelopeSize': _params.maxEnvelopeSize
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
        'operationTimeout': _params.operationTimeout,
        'maxEnvelopeSize': _params.maxEnvelopeSize
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
        'operationTimeout': _params.operationTimeout,
        'maxEnvelopeSize': _params.maxEnvelopeSize
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
        // A new command is a new byte stream: a partial character still held from
        // the previous one would corrupt this command's first chunk.
        _params.streamDecoders = undefined;
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
        '; exit $LASTEXITCODE}"'
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
                if (Object.prototype.hasOwnProperty.call(stream['$'], 'End')) {
                    streamOutput.end = true;
                    // Surface whatever the decoder is still holding instead of
                    // dropping it: on the utf8 path an incomplete sequence at
                    // end-of-stream would otherwise vanish silently. Never fires
                    // on the default latin1 path, which buffers nothing.
                    let remainder = flushStreamDecoder(_params, streamOutput.name);
                    if (remainder) {
                        streamOutput.data = remainder;
                    }
                } else if (stream['_']) {
                    streamOutput.data = getStreamDecoder(_params, streamOutput.name)
                        .write(Buffer.from(stream['_'], 'base64'));
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

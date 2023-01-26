const http = require('http');
const https = require('https');
const xml2jsparser = require('xml2js').parseString;

const DEFAULT_TIMEOUT = 2 * 60 * 1000;

module.exports.sendHttp = async function (_data, _host, _port, _path, _auth, _agent, _requestOptions) {
    var xmlRequest = _data;
    var options = {
        agent: _agent,
        host: _host,
        port: _port,
        path: _path,
        method: 'POST',
        timeout: DEFAULT_TIMEOUT
    };
    let headers = {
        'Authorization': _auth,
        'Content-Type': 'application/soap+xml;charset=UTF-8',
        'User-Agent': 'NodeJS WinRM Client',
        'Content-Length': Buffer.byteLength(xmlRequest)
    };
    if (!_auth) {
        delete headers.Authorization;
    }

    // merge request options and headers
    if (_requestOptions) {
        Object.assign(options, _requestOptions);
        headers = Object.assign(headers, _requestOptions.headers);
    }
    options.headers = headers;

    let requestFn = options && options.protocol === 'https:' ? https.request : http.request;
    return new Promise((resolve, reject) => {
        var req = requestFn(options, (res) => {
            if (res.statusCode < 200 || res.statusCode > 299 && res.statusCode != 500) {
                reject(new Error('Failed to process the request, status Code: ' + res.statusCode));
            }
            res.setEncoding('utf8');
            var dataBuffer = '';
            res.on('data', (chunk) => {
                dataBuffer += chunk;

            });
            res.on('end', () => {
                if (!dataBuffer) {
                    reject(new Error('Failed to process the request, status Code: ' + res.statusCode));
                    return;
                }
                xml2jsparser(dataBuffer, (err, result) => {
                    if (err) {
                        reject(new Error('Data Parsing error', err));
                    }
                    resolve(result);
                });
            });

        });

        if (options.timeout > 0) {
            // This is modelled on what the npm request library does with req timeouts
            req.setTimeout(options.timeout, function () {
                if (req) {
                    req.abort()
                    var e = new Error('ESOCKETTIMEDOUT');
                    e.code = 'ESOCKETTIMEDOUT';
                    e.connect = false;
                    req.emit('error', e);
                }
            });
        }
        req.on('error', (err) => {
            reject(err);
        });
        if (xmlRequest) {
            req.write(xmlRequest);
        }
        req.end();

    });
};

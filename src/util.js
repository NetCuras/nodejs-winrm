
const xplExp = /(\/\/?)|(text\(\))|@([-_a-zA-Z0-9:.]+)|([-_a-zA-Z0-9:.]+)/g;

const xplGrp = {
    delim: 1,
    text: 2,
    attr: 3,
    elem: 4
};

function xpathlite(obj, path) {
    if (typeof path === 'string') {
        let strPath = path;
        path = [];
        let match;
        do {
            match = xplExp.exec(strPath);
            if (match) {
                path.push(match);
            }
        } while (match);
        return xpathlite(obj, path);
    }

    let segment = path[0];
    if (!segment) {
        return [obj];
    }
    if (typeof obj === 'undefined') {
        return [];
    }
    if (!Array.isArray(obj)) {
        obj = [obj];
    }

    let results = [];
    if (segment[xplGrp.delim] === '/') {
        return xpathlite(obj, path.slice(1));
    } else if (segment[xplGrp.delim] === '//') {
        for (let node of obj) {
            for (let name in node) {
                if (typeof node[name] === 'object' && name !== '$' && name !== '_') {
                    results.push(...xpathlite(node[name], path.slice(1)));
                    results.push(...xpathlite(node[name], path.slice(0)));
                }
            }
        }
    } else if (segment[xplGrp.text]) {
        for (let node of obj) {
            if (typeof node === 'string') {
                results.push(node);
            } else if (typeof node['_'] !== 'undefined') {
                results.push(node['_']);
            }
        }
        results = [results.join('')];
    } else if (segment[xplGrp.attr]) {
          let name = segment[xplGrp.attr];
          for (let node of obj) {
              if (node['$'] && typeof node['$'][name] !== 'undefined') {
                  results.push(...xpathlite(node['$'][name], path.slice(1)));
              }
          }
    } else if (segment[xplGrp.elem]) {
        let name = segment[xplGrp.elem];
        for (let node of obj) {
            if (typeof node[name] !== 'undefined') {
                results.push(...xpathlite(node[name], path.slice(1)));
            }
        }
    }
    return results;
}

module.exports.xpathlite = xpathlite;

module.exports.faultFormatter = function (faultElement) {
    let faultCode = xpathlite(faultElement, '//s:Code/s:Subcode/s:Value/text()')[0] || 'Unknown Fault';
    let faultReason = xpathlite(faultElement, '//s:Reason/s:Text/text()')[0];

    if (faultReason) {
        return `${faultCode}: ${faultReason}`;
    }
    return `${faultCode}`;
};

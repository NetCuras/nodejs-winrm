module.exports.faultFormatter = function (faultElement) {
    let faultCode = 'Unknown Fault';
    let faultReason = '';

    if (faultElement[0]['s:Code'] && faultElement[0]['s:Code'][0]['s:Subcode'] && faultElement[0]['s:Code'][0]['s:Subcode'][0]['s:Value']) {
        faultCode = faultElement[0]['s:Code'][0]['s:Subcode'][0]['s:Value'];
    }
    if (faultElement[0]['s:Reason'] && faultElement[0]['s:Reason'][0]['s:Text'] && faultElement[0]['s:Reason'][0]['s:Text'][0]['_']) {
        faultReason = faultElement[0]['s:Reason'][0]['s:Text'][0]['_'];
    }

    if (faultReason) {
        return `${faultCode}: ${faultReason}`;
    }
    return `${faultCode}`;
};

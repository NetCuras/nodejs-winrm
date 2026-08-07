const winrm_soap_req = require('../src/base-request.js');

const DEFAULT_MAX_ENVELOPE_SIZE = '153600';

function getMaxEnvelopeSize(_params) {
    var header = winrm_soap_req.getSoapHeaderRequest(Object.assign({
        'action': 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull'
    }, _params));
    return header['s:Header']['wsman:MaxEnvelopeSize']['#'];
}

describe('getSoapHeaderRequest MaxEnvelopeSize', () => {
    it('defaults to 153600 when maxEnvelopeSize is not set', () => {
        expect(getMaxEnvelopeSize({})).toBe(DEFAULT_MAX_ENVELOPE_SIZE);
    });

    it('keeps the rest of the header unchanged when maxEnvelopeSize is not set', () => {
        var header = winrm_soap_req.getSoapHeaderRequest({
            'action': 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/Pull',
            'message_id': '00000000-0000-0000-0000-000000000000'
        });
        expect(header['s:Header']['wsman:MaxEnvelopeSize']).toEqual({
            '@': {
                'mustUnderstand': 'true'
            },
            '#': DEFAULT_MAX_ENVELOPE_SIZE
        });
    });

    it('honours a custom numeric value', () => {
        expect(getMaxEnvelopeSize({ 'maxEnvelopeSize': 512000 })).toBe('512000');
    });

    it('honours a custom value supplied as a numeric string', () => {
        expect(getMaxEnvelopeSize({ 'maxEnvelopeSize': '512000' })).toBe('512000');
    });

    it('falls back to the default for junk values', () => {
        const junkValues = [
            undefined,
            null,
            0,
            -1,
            -153600,
            1.5,
            NaN,
            Infinity,
            '',
            ' ',
            'lots',
            '512000abc',
            true,
            false,
            {},
            [],
            [512000]
        ];
        for (const junk of junkValues) {
            expect(getMaxEnvelopeSize({ 'maxEnvelopeSize': junk })).toBe(DEFAULT_MAX_ENVELOPE_SIZE);
        }
    });
});

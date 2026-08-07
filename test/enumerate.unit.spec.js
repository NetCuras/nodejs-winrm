const winrm_enumerate = require('../src/enumerate.js');

// doEnumerateAll drives the other exports through module.exports, so spying on
// them exercises the real loop without any HTTP.
function stubBeginEnumeration(_items) {
    return jest.spyOn(winrm_enumerate, 'doBeginEnumeration').mockImplementation(async (_params) => {
        _params.enumerationId = 'enum-context-1';
        _params.endOfSequence = false;
        return _items;
    });
}

describe('doEnumerateAll enumeration release', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('releases the enumeration when a pull returns an error', async () => {
        var pullError = new Error('wsman fault on pull');
        stubBeginEnumeration([{ Name: 'first' }]);
        jest.spyOn(winrm_enumerate, 'doPullEnumeration').mockResolvedValue(pullError);
        var release = jest.spyOn(winrm_enumerate, 'doReleaseEnumeration').mockResolvedValue('success');

        var result = await winrm_enumerate.doEnumerateAll({});

        expect(release).toHaveBeenCalledTimes(1);
        // The original error is still what comes back — the release must not
        // replace or mask it.
        expect(result).toBe(pullError);
    });

    it('releases the enumeration when a pull rejects, and rethrows the original error', async () => {
        var socketError = new Error('ESOCKETTIMEDOUT');
        socketError.code = 'ESOCKETTIMEDOUT';
        stubBeginEnumeration([{ Name: 'first' }]);
        jest.spyOn(winrm_enumerate, 'doPullEnumeration').mockRejectedValue(socketError);
        var release = jest.spyOn(winrm_enumerate, 'doReleaseEnumeration').mockResolvedValue('success');

        await expect(winrm_enumerate.doEnumerateAll({})).rejects.toBe(socketError);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the release itself fails', async () => {
        var pullError = new Error('wsman fault on pull');
        stubBeginEnumeration([{ Name: 'first' }]);
        jest.spyOn(winrm_enumerate, 'doPullEnumeration').mockResolvedValue(pullError);
        jest.spyOn(winrm_enumerate, 'doReleaseEnumeration').mockRejectedValue(new Error('release failed'));

        var result = await winrm_enumerate.doEnumerateAll({});

        expect(result).toBe(pullError);
    });

    it('does not mask a rejected pull when the release also fails', async () => {
        var socketError = new Error('socket hang up');
        stubBeginEnumeration([{ Name: 'first' }]);
        jest.spyOn(winrm_enumerate, 'doPullEnumeration').mockRejectedValue(socketError);
        jest.spyOn(winrm_enumerate, 'doReleaseEnumeration').mockRejectedValue(new Error('release failed'));

        await expect(winrm_enumerate.doEnumerateAll({})).rejects.toBe(socketError);
    });

    it('bounds the release and restores the caller values afterwards', async () => {
        var released = {};
        stubBeginEnumeration([{ Name: 'first' }]);
        jest.spyOn(winrm_enumerate, 'doPullEnumeration').mockResolvedValue(new Error('wsman fault on pull'));
        jest.spyOn(winrm_enumerate, 'doReleaseEnumeration').mockImplementation(async (_params) => {
            released.maxTime = _params.maxTime;
            released.operationTimeout = _params.operationTimeout;
            released.timeout = _params.requestOptions.timeout;
            return 'success';
        });

        var params = {
            'maxTime': 'PT60S',
            'operationTimeout': 'PT60S',
            'requestOptions': { 'timeout': 120000 }
        };
        await winrm_enumerate.doEnumerateAll(params);

        expect(released).toEqual({
            'maxTime': 'PT10S',
            'operationTimeout': 'PT10S',
            'timeout': 10000
        });
        // The caller's params are reused across requests, so the short release
        // budget must not outlive the release.
        expect(params.maxTime).toBe('PT60S');
        expect(params.operationTimeout).toBe('PT60S');
        expect(params.requestOptions).toEqual({ 'timeout': 120000 });
    });

    it('does not release when the enumeration ran to EndOfSequence', async () => {
        stubBeginEnumeration([{ Name: 'first' }]);
        jest.spyOn(winrm_enumerate, 'doPullEnumeration').mockImplementation(async (_params) => {
            _params.endOfSequence = true;
            return [{ Name: 'second' }];
        });
        var release = jest.spyOn(winrm_enumerate, 'doReleaseEnumeration').mockResolvedValue('success');

        var result = await winrm_enumerate.doEnumerateAll({});

        // The server closes the enumeration itself at EndOfSequence — releasing
        // again would be a wasted round trip on every successful read.
        expect(release).not.toHaveBeenCalled();
        expect(result).toEqual([{ Name: 'first' }, { Name: 'second' }]);
    });

    it('does not release when the initial enumerate fails', async () => {
        var beginError = new Error('wsman fault on enumerate');
        jest.spyOn(winrm_enumerate, 'doBeginEnumeration').mockResolvedValue(beginError);
        var pull = jest.spyOn(winrm_enumerate, 'doPullEnumeration').mockResolvedValue([]);
        var release = jest.spyOn(winrm_enumerate, 'doReleaseEnumeration').mockResolvedValue('success');

        var result = await winrm_enumerate.doEnumerateAll({});

        // A faulted Enumerate never established a context to release.
        expect(result).toBe(beginError);
        expect(pull).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
    });
});

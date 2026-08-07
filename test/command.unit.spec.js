const winrm_command = require('../src/command.js');
const winrm_http_req = require('../src/http.js');

// Minimal shape of what sendHttp resolves to for a Receive response: one
// rsp:Stream element per chunk, each base64 as it comes off the wire.
function receiveResponse(_chunks) {
    return {
        's:Envelope': {
            's:Body': [{
                'rsp:ReceiveResponse': [{
                    'rsp:Stream': _chunks.map(chunk => ({
                        '$': { 'Name': chunk.name },
                        '_': chunk.buffer.toString('base64')
                    }))
                }]
            }]
        }
    };
}

function endResponse(_name) {
    return {
        's:Envelope': {
            's:Body': [{
                'rsp:ReceiveResponse': [{
                    'rsp:Stream': [{ '$': { 'Name': _name, 'End': 'true' } }]
                }]
            }]
        }
    };
}

function stubReceives(_responses) {
    var send = jest.spyOn(winrm_http_req, 'sendHttp');
    for (const response of _responses) {
        send.mockResolvedValueOnce(response);
    }
    return send;
}

// 'café' — the é is 0xC3 0xA9, two bytes, so a split at index 4 lands inside it.
const CAFE = Buffer.from('café', 'utf8');
// Bytes the old ascii decode corrupted. 0xE9 is also a valid UTF-8 lead byte,
// which is what makes it the interesting case.
const HIGH_BYTES = Buffer.from([0x00, 0x41, 0x7f, 0x80, 0x82, 0xe9, 0xfe, 0xff]);

describe('doReceive default decoding', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('decodes pure ASCII exactly as the previous ascii decode did', async () => {
        var ascii = Buffer.from('Directory of C:\\Windows\r\n<DIR> System32\r\n', 'ascii');
        stubReceives([receiveResponse([{ name: 'stdout', buffer: ascii }])]);

        var response = await winrm_command.doReceive({});

        expect(response.streams[0].data).toBe(ascii.toString('ascii'));
    });

    it('round-trips high bytes losslessly instead of masking the high bit', async () => {
        stubReceives([receiveResponse([{ name: 'stdout', buffer: HIGH_BYTES }])]);

        var response = await winrm_command.doReceive({});

        expect(Buffer.from(response.streams[0].data, 'latin1')).toEqual(HIGH_BYTES);
        // The old decode turned 0xE9 into 'i' — a character the device never sent.
        expect(response.streams[0].data).not.toBe(HIGH_BYTES.toString('ascii'));
    });

    it('keeps one byte to one character, buffering nothing', async () => {
        stubReceives([
            receiveResponse([{ name: 'stdout', buffer: Buffer.from([0xe9]) }]),
            receiveResponse([{ name: 'stdout', buffer: Buffer.from([0xc3]) }])
        ]);

        var params = {};
        var first = await winrm_command.doReceive(params);
        var second = await winrm_command.doReceive(params);

        // Structural parity with the old ascii decode: a chunk never comes back
        // empty because bytes are being held for a later one.
        expect(first.streams[0].data).toHaveLength(1);
        expect(second.streams[0].data).toHaveLength(1);
    });

    it('decodes byte-identically to the old behaviour when ascii is asked for', async () => {
        stubReceives([receiveResponse([{ name: 'stdout', buffer: HIGH_BYTES }])]);

        var response = await winrm_command.doReceive({ 'encoding': 'ascii' });

        expect(response.streams[0].data).toBe(HIGH_BYTES.toString('ascii'));
    });

    it('falls back to the default when the encoding is not a valid one', async () => {
        stubReceives([receiveResponse([{ name: 'stdout', buffer: HIGH_BYTES }])]);

        var response = await winrm_command.doReceive({ 'encoding': 'klingon' });

        expect(Buffer.from(response.streams[0].data, 'latin1')).toEqual(HIGH_BYTES);
    });

    it('marks the end stream without decoding data', async () => {
        stubReceives([endResponse('stdout')]);

        var response = await winrm_command.doReceive({});

        expect(response.streams[0]).toEqual({ 'name': 'stdout', 'end': true });
    });
});

describe('doReceive utf8 decoding (opt-in)', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reassembles a multi-byte character split across two Receive responses', async () => {
        stubReceives([
            receiveResponse([{ name: 'stdout', buffer: CAFE.subarray(0, 4) }]),
            receiveResponse([{ name: 'stdout', buffer: CAFE.subarray(4) }])
        ]);

        var params = { 'encoding': 'utf8' };
        var first = await winrm_command.doReceive(params);
        var second = await winrm_command.doReceive(params);
        var output = first.streams[0].data + second.streams[0].data;

        expect(output).toBe('café');
        // Per-chunk decoding is what produced these; the decoder must hold the
        // incomplete sequence instead.
        expect(output).not.toContain('\uFFFD');
    });

    it('reassembles a multi-byte character split across chunks in one response', async () => {
        stubReceives([
            receiveResponse([
                { name: 'stdout', buffer: CAFE.subarray(0, 4) },
                { name: 'stdout', buffer: CAFE.subarray(4) }
            ])
        ]);

        var response = await winrm_command.doReceive({ 'encoding': 'utf8' });

        expect(response.streams.map(s => s.data).join('')).toBe('café');
    });

    it('keeps stdout and stderr decoding independent', async () => {
        var bang = Buffer.from('bäng', 'utf8');
        stubReceives([
            receiveResponse([
                { name: 'stdout', buffer: CAFE.subarray(0, 4) },
                { name: 'stderr', buffer: bang.subarray(0, 2) },
                { name: 'stdout', buffer: CAFE.subarray(4) },
                { name: 'stderr', buffer: bang.subarray(2) }
            ])
        ]);

        var response = await winrm_command.doReceive({ 'encoding': 'utf8' });
        var stdout = response.streams.filter(s => s.name === 'stdout').map(s => s.data).join('');
        var stderr = response.streams.filter(s => s.name === 'stderr').map(s => s.data).join('');

        // A single shared decoder would feed stderr's bytes into stdout's
        // half-finished character and corrupt both.
        expect(stdout).toBe('café');
        expect(stderr).toBe('bäng');
    });

    it('honours a UTF-8 spelling the decoder normalises', async () => {
        stubReceives([
            receiveResponse([{ name: 'stdout', buffer: CAFE.subarray(0, 4) }]),
            receiveResponse([{ name: 'stdout', buffer: CAFE.subarray(4) }])
        ]);

        // A rebuilt-per-chunk decoder would drop the buffered lead byte here.
        var params = { 'encoding': 'UTF-8' };
        var first = await winrm_command.doReceive(params);
        var second = await winrm_command.doReceive(params);

        expect(first.streams[0].data + second.streams[0].data).toBe('café');
    });

    it('flushes a held incomplete sequence at end of stream rather than dropping it', async () => {
        stubReceives([
            receiveResponse([{ name: 'stdout', buffer: Buffer.from([0xe9]) }]),
            endResponse('stdout')
        ]);

        var params = { 'encoding': 'utf8' };
        var first = await winrm_command.doReceive(params);
        var last = await winrm_command.doReceive(params);

        // 0xE9 is a valid lead byte, so the decoder holds it; without the flush
        // it would vanish silently at end of stream.
        expect(first.streams[0].data).toBe('');
        expect(last.streams[0].end).toBe(true);
        expect(last.streams[0].data).toBe('\uFFFD');
    });

    it('does not carry a partial character across into the next command', async () => {
        var commandResponse = {
            's:Envelope': {
                's:Body': [{
                    'rsp:CommandResponse': [{ 'rsp:CommandId': ['command-2'] }]
                }]
            }
        };
        stubReceives([
            receiveResponse([{ name: 'stdout', buffer: CAFE.subarray(0, 4) }]),
            commandResponse,
            receiveResponse([{ name: 'stdout', buffer: Buffer.from('ok', 'utf8') }])
        ]);

        var params = { 'shellId': 'shell-1', 'command': 'first', 'encoding': 'utf8' };
        await winrm_command.doReceive(params);
        // The first command ended mid-character; the next command's output must
        // not inherit those bytes.
        params.commandId = await winrm_command.doExecuteCommand(params);
        var response = await winrm_command.doReceive(params);

        expect(response.streams[0].data).toBe('ok');
    });
});

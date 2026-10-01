"""Gemini helpers (key from GEMINI_API_KEY): image, tts, music."""
import os, sys, json, base64, urllib.request, wave
KEY = os.environ['GEMINI_API_KEY']
def call(model, body, timeout=600):
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.read().decode()[:600]); raise
def parts(r): return [p for c in r.get('candidates', []) for p in c.get('content', {}).get('parts', [])]
def image(prompt, out, model='gemini-3-pro-image', aspect='16:9', size='2K'):
    r = call(model, {'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'responseModalities': ['IMAGE'], 'imageConfig': {'aspectRatio': aspect, 'imageSize': size}}})
    for p in parts(r):
        if 'inlineData' in p: open(out, 'wb').write(base64.b64decode(p['inlineData']['data'])); return out
    print(json.dumps(r)[:800]); return None
def tts(text, out, voice='Charon', model='gemini-3.8-flash-tts', style='', system=None):
    body = {'contents': [{'parts': [{'text': (style + ' ' if style else '') + text}]}]}
    if system: body['systemInstruction'] = {'parts': [{'text': system}]}
    r = call(model, {**body,
        'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}}})
    for p in parts(r):
        if 'inlineData' in p:
            d = p['inlineData']; raw = base64.b64decode(d['data']); mt = d.get('mimeType', '')
            rate = int(mt.split('rate=')[1].split(';')[0]) if 'rate=' in mt else 24000
            if 'wav' in mt or raw[:4] == b'RIFF': open(out, 'wb').write(raw)
            else:
                w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(raw); w.close()
            return out, mt
    print(json.dumps(r)[:800]); return None
def music(prompt, out, model='lyria-3.5'):
    r = call(model, {'contents': [{'parts': [{'text': prompt}]}]}, timeout=900)
    for p in parts(r):
        if 'inlineData' in p:
            d = p['inlineData']; open(out, 'wb').write(base64.b64decode(d['data'])); return out, d.get('mimeType')
        if 'text' in p: print('TEXT:', p['text'][:300])
    print(json.dumps(r)[:800]); return None
if __name__ == '__main__':
    kind = sys.argv[1]
    if kind == 'tts': print(tts(sys.argv[2], sys.argv[3], *(sys.argv[4:5])))
    if kind == 'image': print(image(sys.argv[2], sys.argv[3]))
    if kind == 'music': print(music(sys.argv[2], sys.argv[3]))

import sys, base64; sys.path.insert(0, 'scripts'); import gem
for f in sys.argv[1:]:
    b = base64.b64encode(open(f, 'rb').read()).decode()
    r = gem.call('gemini-2.5-flash', {'contents': [{'parts': [{'inlineData': {'mimeType': 'audio/wav', 'data': b}}, {'text': 'Transcribe this audio exactly, word for word. Also give the start and end time in seconds of the speech. Answer as: TEXT | start | end'}]}]})
    print(f, '->', gem.parts(r)[0]['text'].strip())

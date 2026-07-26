import { YouTubeTranscriptProvider } from '../src/transcript/youtube-provider.js';

async function run() {
  const provider = new YouTubeTranscriptProvider();
  const tracks = await provider.getAvailableTracks('8dT2jCIplUU');
  console.log('Tracks:', tracks);
  for (const track of tracks) {
    console.log(`\nFetching ${track.name?.simpleText} (${track.sourceType}) [${track.languageCode}]...`);
    const fetchUrl = track.baseUrl;
    console.log('URL:', fetchUrl);
    
    // Try fetching with Node fetch
    const response = await fetch(fetchUrl);
    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Response Length:', text.length);
    if (text.length < 200) {
      console.log('Response:', text);
    }
  }
}
run();

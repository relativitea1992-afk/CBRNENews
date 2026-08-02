import fs from 'fs';

async function testOgMap() {
  // Let's just run a local GET request to the Next.js server for the OG endpoint.
  // Next.js needs to be running. Since I can't start a server and fetch easily in one script without waiting,
  // I will just use `tsx` to run this while Next.js is running? 
  // Wait, I can just write a script that makes the request.
  const res = await fetch('http://localhost:3000/api/og/map?lat=1.3521&lon=103.8198&type=Biological');
  if (res.ok) {
    const buffer = await res.arrayBuffer();
    fs.writeFileSync('test-map.png', Buffer.from(buffer));
    console.log('Saved test-map.png');
  } else {
    console.error('Failed', await res.text());
  }
}

testOgMap().catch(console.error);

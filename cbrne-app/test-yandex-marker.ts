import fs from 'fs';

async function testYandex() {
  const customIconUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Radiation_warning_symbol.svg/10px-Radiation_warning_symbol.svg.png';
  // I need to encode the URL if Yandex supports it.
  // Actually Yandex docs for 1.x say: "pt=lon,lat,style"
  // Is it possible to use a custom image? 
  // "Since 2016, custom markers in Static API are not supported or have limitations."
  
  // Let's try Google Maps Static API format:
  // &markers=icon:https://...
}

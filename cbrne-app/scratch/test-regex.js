function testRegex() {
  let outcome = "Verified: Total 10 new articles (NewsAPI: 10) via Gemini [gemini-3.5-flash-lite] | Tokens Consumed: 3405 [In: 3165, Out: 240] | Models: gemini-3.5-flash-lite | Ingress: 78900 bytes | Egress: 0 bytes. No relevant threats detected.";
  
  outcome = outcome.replace(/ \| Models: .*? \| Ingress: \d+ bytes/g, '');
  outcome = outcome.replace(/ \| Models: [^|]+/g, '');
  outcome = outcome.replace(/ \| Ingress: \d+ bytes/g, '');
  outcome = outcome.replace(/ \| Egress: \d+ bytes/g, '');

  console.log("Outcome after regex:", outcome);
}
testRegex();

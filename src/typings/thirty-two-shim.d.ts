// We have to declare the module in a definition file but we actually augment it in a ts file
// so it'll get type checked even though we have `skipLibCheck: true`
declare module 'thirty-two';

import * as Promise from 'bluebird';
import * as mockery from 'mockery';
import * as requestmock from 'requestmock';

requestmock.configure({ Promise });

mockery.enable({ warnOnUnregistered: false });
mockery.registerMock('request', requestmock);

export = requestmock;

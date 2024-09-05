export const config = {
  configVersion: 'v1',
  kubernetes: [
    {
      apiVersion: 'wingcloud.com/v1',
      kind: 'GitContent',
      executeHookOnEvent: ['Added', 'Modified', 'Deleted'],
    },
  ],
};
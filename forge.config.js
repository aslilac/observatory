module.exports = {
  packagerConfig: {
    appBundleId: 'la.mckay.observatory',
    appCategoryType: 'public.app-category.utilities',
    appCopyright: '© 2019 ♥ McKayla',
    darwinDarkModeSupport: true,
    ignore: [ 'client/.+\.js', 'electron/.+\.js' ],
    name: 'Observatory',
    out: 'target'
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg'
    },
    {
      name: '@electron-forge/maker-squirrel'
    }
  ]
}
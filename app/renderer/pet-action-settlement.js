(function attachPetActionSettlement(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.petActionSettlement = api;
})(typeof window === 'undefined' ? null : window, function createPetActionSettlement() {
  async function invoke(request, isSuperseded, onFailure) {
    try {
      return { status: 'resolved', value: await request() };
    } catch (error) {
      if (isSuperseded()) return { status: 'superseded' };
      onFailure(error);
      return { status: 'rejected' };
    }
  }

  return { invoke };
});

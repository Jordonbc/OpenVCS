use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::{BackendId, Capabilities, OnEvent, Result, Vcs, models};

#[derive(Clone, Debug)]
pub struct DummyVcs {
    workdir: PathBuf,
}

impl DummyVcs {
    pub fn new(path: &Path) -> Self {
        Self {
            workdir: path.to_path_buf(),
        }
    }

    pub fn default_caps() -> Capabilities {
        let mut caps = Capabilities::default();
        caps.commits = true;
        caps
    }
}

impl Vcs for DummyVcs {
    fn id(&self) -> BackendId {
        crate::backend_id!("dummy-test")
    }

    fn caps(&self) -> Capabilities {
        Self::default_caps()
    }

    fn open(path: &Path) -> Result<Self>
    where
        Self: Sized,
    {
        Ok(Self::new(path))
    }

    fn clone(_url: &str, dest: &Path, _on: Option<OnEvent>) -> Result<Self>
    where
        Self: Sized,
    {
        Ok(Self::new(dest))
    }

    fn workdir(&self) -> &Path {
        &self.workdir
    }

    fn current_branch(&self) -> Result<Option<String>> {
        Ok(Some("main".into()))
    }

    fn branches(&self) -> Result<Vec<models::BranchItem>> {
        Ok(Vec::new())
    }

    fn local_branches(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    fn create_branch(&self, _name: &str, _checkout: bool) -> Result<()> {
        Ok(())
    }

    fn checkout_branch(&self, _name: &str) -> Result<()> {
        Ok(())
    }

    fn ensure_remote(&self, _name: &str, _url: &str) -> Result<()> {
        Ok(())
    }

    fn list_remotes(&self) -> Result<Vec<(String, String)>> {
        Ok(Vec::new())
    }

    fn remove_remote(&self, _name: &str) -> Result<()> {
        Ok(())
    }

    fn fetch(&self, _remote: &str, _refspec: &str, _on: Option<OnEvent>) -> Result<()> {
        Ok(())
    }

    fn push(&self, _remote: &str, _refspec: &str, _on: Option<OnEvent>) -> Result<()> {
        Ok(())
    }

    fn pull_ff_only(&self, _remote: &str, _branch: &str, _on: Option<OnEvent>) -> Result<()> {
        Ok(())
    }

    fn commit(
        &self,
        _message: &str,
        _name: &str,
        _email: &str,
        _paths: &[PathBuf],
    ) -> Result<String> {
        Ok("dummy-commit".into())
    }

    fn commit_index(&self, _message: &str, _name: &str, _email: &str) -> Result<String> {
        Ok("dummy-commit".into())
    }

    fn status_summary(&self) -> Result<models::StatusSummary> {
        Ok(models::StatusSummary::default())
    }

    fn status_payload(&self) -> Result<models::StatusPayload> {
        Ok(models::StatusPayload::default())
    }

    fn log_commits(&self, _query: &models::LogQuery) -> Result<Vec<models::CommitItem>> {
        Ok(Vec::new())
    }

    fn diff_file(&self, _path: &Path) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    fn diff_commit(&self, _rev: &str) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    fn stage_patch(&self, _patch: &str) -> Result<()> {
        Ok(())
    }

    fn discard_paths(&self, _paths: &[PathBuf]) -> Result<()> {
        Ok(())
    }

    fn apply_reverse_patch(&self, _patch: &str) -> Result<()> {
        Ok(())
    }

    fn delete_branch(&self, _name: &str, _force: bool) -> Result<()> {
        Ok(())
    }

    fn rename_branch(&self, _old: &str, _new: &str) -> Result<()> {
        Ok(())
    }

    fn merge_into_current(&self, _name: &str) -> Result<()> {
        Ok(())
    }

    fn hard_reset_head(&self) -> Result<()> {
        Ok(())
    }

    fn get_identity(&self) -> Result<Option<(String, String)>> {
        Ok(Some(("Dummy User".into(), "dummy@example.com".into())))
    }

    fn set_identity_local(&self, _name: &str, _email: &str) -> Result<()> {
        Ok(())
    }
}

pub fn dummy_caps() -> Capabilities {
    DummyVcs::default_caps()
}

pub fn dummy_open(path: &Path) -> Result<Arc<dyn Vcs>> {
    Ok(Arc::new(DummyVcs::new(path)) as Arc<dyn Vcs>)
}

pub fn dummy_clone_repo(_url: &str, dest: &Path, _on: Option<OnEvent>) -> Result<Arc<dyn Vcs>> {
    Ok(Arc::new(DummyVcs::new(dest)) as Arc<dyn Vcs>)
}

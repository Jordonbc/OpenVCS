use serde::{Deserialize, Deserializer};
use std::borrow::Cow;
use std::fmt;

/// Backend identifiers are stable, kebab-case strings registered by each backend crate.
#[derive(Debug)]
pub struct BackendId(pub Cow<'static, str>);

impl BackendId {
    pub fn as_str(&self) -> &str {
        self.0.as_ref()
    }
}

impl From<String> for BackendId {
    fn from(s: String) -> Self {
        BackendId(Cow::Owned(s))
    }
}

impl<'de> Deserialize<'de> for BackendId {
    fn deserialize<D>(de: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let deserialised_string = String::deserialize(de)?;
        Ok(BackendId(Cow::Owned(deserialised_string)))
    }
}

impl From<&str> for BackendId {
    fn from(s: &str) -> Self {
        BackendId(Cow::Owned(s.to_owned()))
    }
}

impl AsRef<str> for BackendId {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for BackendId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl PartialEq<&str> for BackendId {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

#[macro_export]
macro_rules! backend_id {
    ($lit:literal) => {
        $crate::BackendId(::std::borrow::Cow::Borrowed($lit))
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn from_string_and_str_produce_expected_values() {
        let owned = BackendId::from(String::from("git"));
        let borrowed = BackendId::from("git");

        assert_eq!(owned.as_str(), "git");
        assert_eq!(borrowed.as_str(), "git");
        assert!(borrowed == "git");
    }

    #[test]
    fn displays_inner_string() {
        let id = BackendId::from("libgit2");
        assert_eq!(id.to_string(), "libgit2");
    }

    #[test]
    fn serde_deserialises_from_json_string() {
        let id: BackendId = serde_json::from_value(json!("git")).expect("deserialise backend id");
        assert_eq!(id.as_str(), "git");
    }

    #[test]
    fn macro_creates_borrowed_backend_id() {
        let id = backend_id!("memory");
        match id.0 {
            Cow::Borrowed(value) => assert_eq!(value, "memory"),
            Cow::Owned(_) => panic!("backend_id! should borrow literals"),
        }
    }
}

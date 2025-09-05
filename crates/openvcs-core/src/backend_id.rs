use std::borrow::Cow;
use std::fmt;
use serde::{Deserialize, Deserializer};

/// Backend identifiers are stable, kebab-case strings registered by each backend crate.
#[derive(Debug)]
pub struct BackendId(pub Cow<'static, str>);

impl BackendId {
    pub fn as_str(&self) -> &str { self.0.as_ref() }
}

impl From<String> for BackendId {
    fn from(s: String) -> Self { BackendId(Cow::Owned(s)) }
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
    fn from(s: &str) -> Self { BackendId(Cow::Owned(s.to_owned())) }
}

impl AsRef<str> for BackendId {
    fn as_ref(&self) -> &str { self.as_str() }
}

impl fmt::Display for BackendId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl PartialEq<&str> for BackendId {
    fn eq(&self, other: &&str) -> bool { self.as_str() == *other }
}

#[macro_export]
macro_rules! backend_id {
    ($lit:literal) => { $crate::BackendId(::std::borrow::Cow::Borrowed($lit)) };
}
